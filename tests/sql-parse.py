"""Parse SQL/PLpgSQL locally. This script never connects to or executes a database."""
import re
from pathlib import Path

import pglast
from pglast import ast
from pglast.stream import RawStream

root = Path(__file__).resolve().parent.parent
contracts = {}
for relative in (
    'supabase/schema.sql',
    'supabase/migrations/20261026_subjects_groups_sharing.sql',
    'supabase/preflight_subjects_groups_sharing.sql',
    'supabase/migrations/20261027_admin_roles.sql',
    'supabase/migrations/20261028_profile_letterhead_layout.sql',
    'supabase/migrations/20261029_questions_page.sql',
    'supabase/migrations/20261030_library_pages_exam_revisions.sql',
    'supabase/assign_first_admin.example.sql',
):
    sql = (root / relative).read_text(encoding='utf-8')
    statements = pglast.parse_sql(sql)
    functions = list(re.finditer(r'create or replace function (?:public|teacher_bank_private)\.(\w+)\([\s\S]*?\$\$;', sql))
    for match in functions:
        pglast.parse_plpgsql(match[0])
    blocks = re.findall(r'do \$\$[\s\S]*?\$\$;', sql, flags=re.I)
    for block in blocks:
        pglast.parse_plpgsql(block)
    if 'preflight_' in relative:
        assert all(isinstance(statement.stmt, ast.SelectStmt) for statement in statements), 'Diagnostic must contain SELECT only'
    elif '.example.sql' not in relative:
        contracts[relative] = {
            kind.__name__: sorted(RawStream()(statement.stmt) for statement in statements if isinstance(statement.stmt, kind))
            for kind in (ast.CreateFunctionStmt, ast.CreatePolicyStmt, ast.CreateTrigStmt, ast.GrantStmt, ast.IndexStmt)
        }
    print(f'{relative}: {len(statements)} SQL statements, {len(functions)} functions, {len(blocks)} DO blocks parsed; no execution')
print(f'Parser: pglast {pglast.__version__}')
schema = contracts['supabase/schema.sql']
base = contracts['supabase/migrations/20261026_subjects_groups_sharing.sql']
admin = contracts['supabase/migrations/20261027_admin_roles.sql']
profile_layout = contracts['supabase/migrations/20261028_profile_letterhead_layout.sql']
questions_page = contracts['supabase/migrations/20261029_questions_page.sql']
library_pages = contracts['supabase/migrations/20261030_library_pages_exam_revisions.sql']
for kind in schema:
    assert schema[kind] == sorted(base[kind] + admin[kind] + profile_layout[kind] + questions_page[kind] + library_pages[kind]), f'Schema/migration contract mismatch: {kind}'
    print(f'AST parity {kind}: {len(schema[kind])} definitions match')


def evaluate_metadata(node, row):
    """Evaluate only the parsed exception's metadata expressions, never SQL.

    OIDs are represented by symbolic role/type names. Preserve SQL NULL logic
    so an absent proconfig cannot accidentally bypass the unknown-function gate.
    Fail on unsupported AST nodes instead of silently approximating them.
    """
    if isinstance(node, ast.ColumnRef):
        return row['.'.join(field.sval for field in node.fields)]
    if isinstance(node, ast.A_Const):
        if node.isnull:
            return None
        if isinstance(node.val, ast.String):
            return node.val.sval
        if isinstance(node.val, ast.Integer):
            return node.val.ival
        if isinstance(node.val, ast.Boolean):
            return node.val.boolval
    if isinstance(node, ast.TypeCast):
        return evaluate_metadata(node.arg, row)
    if isinstance(node, ast.A_ArrayExpr):
        return [evaluate_metadata(element, row) for element in node.elements]
    if isinstance(node, ast.NullTest):
        assert node.nulltesttype.name == 'IS_NULL'
        return evaluate_metadata(node.arg, row) is None
    if isinstance(node, ast.BooleanTest):
        assert node.booltesttype.name == 'IS_TRUE'
        return evaluate_metadata(node.arg, row) is True
    if isinstance(node, ast.A_Expr):
        assert [part.sval for part in node.name] == ['=']
        left, right = evaluate_metadata(node.lexpr, row), evaluate_metadata(node.rexpr, row)
        return None if left is None or right is None else left == right
    if isinstance(node, ast.BoolExpr):
        values = [evaluate_metadata(arg, row) for arg in node.args]
        if node.boolop.name == 'AND_EXPR':
            return False if False in values else (None if None in values else True)
        if node.boolop.name == 'NOT_EXPR':
            assert len(values) == 1
            return None if values[0] is None else not values[0]
    raise AssertionError(f'Unsupported metadata expression: {node!r}')


safe_platform_function = {
    'n.nspname': 'public', 'p.proname': 'rls_auto_enable', 'p.prokind': 'f',
    'p.pronargs': 0, 'p.proallargtypes': None, 'p.provariadic': 0,
    'p.proretset': False, 'p.prosecdef': True,
    'p.prorettype': 'pg_catalog.event_trigger', 'p.proowner': 'postgres',
    'p.proconfig': ['search_path=pg_catalog'],
}
rejected_metadata = [
    ('different schema', {'n.nspname': 'other'}),
    ('unknown application function', {'p.proname': 'unknown_application_rpc'}),
    ('unexpected overload', {'p.pronargs': 1}),
    ('OUT arguments', {'p.proallargtypes': ['text']}),
    ('variadic signature', {'p.provariadic': 25}),
    ('procedure', {'p.prokind': 'p'}),
    ('aggregate', {'p.prokind': 'a'}),
    ('ordinary trigger return type', {'p.prorettype': 'pg_catalog.trigger'}),
    ('ordinary function return type', {'p.prorettype': 'pg_catalog.void'}),
    ('set-returning function', {'p.proretset': True}),
    ('untrusted owner', {'p.proowner': 'authenticated'}),
    ('different privileged owner', {'p.proowner': 'supabase_admin'}),
    ('security invoker', {'p.prosecdef': False}),
    ('missing settings', {'p.proconfig': None}),
    ('empty settings', {'p.proconfig': []}),
    ('unsafe path', {'p.proconfig': ['search_path=public']}),
    ('extra path schema', {'p.proconfig': ['search_path=pg_catalog, public']}),
    ('extra function setting', {'p.proconfig': ['search_path=pg_catalog', 'row_security=off']}),
]
exception_asts = []
for relative in ('supabase/schema.sql', 'supabase/migrations/20261026_subjects_groups_sharing.sql'):
    sql = (root / relative).read_text(encoding='utf-8')
    match = re.search(r'-- BEGIN RLS_AUTO_ENABLE_EXCEPTION\n([\s\S]*?)\n\s*-- END RLS_AUTO_ENABLE_EXCEPTION', sql)
    assert match, f'Missing narrow platform exception in {relative}'
    expression = pglast.parse_sql('SELECT ' + match[1])[0].stmt.targetList[0].val
    exception_asts.append(RawStream()(expression))
    assert evaluate_metadata(expression, safe_platform_function) is True
    for label, changes in rejected_metadata:
        assert evaluate_metadata(expression, safe_platform_function | changes) is False, (relative, label)
    # Compare the entire preflight too: exemptions must not diverge elsewhere.
    preflight = re.search(r'do \$\$[\s\S]*?\$\$;', sql, flags=re.I)[0]
    assert "where n.nspname = 'public' and p.prosecdef" in preflight
    assert 'Unknown SECURITY DEFINER functions require manual review' in preflight
    if relative.endswith('schema.sql'):
        schema_preflight = preflight
    else:
        assert preflight == schema_preflight, 'Schema/migration preflight mismatch'
    print(f'{relative}: platform exception accepts expected metadata; rejects {len(rejected_metadata)} unsafe variants')
assert exception_asts[0] == exception_asts[1]
