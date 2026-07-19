import pglast
from collections import Counter
p = r"C:\Users\Flying Phoenix PCs\Desktop\StrikerClips\db\schema.sql"
sql = open(p, encoding="utf-8").read()
try:
    stmts = pglast.parse_sql(sql)
except Exception as e:
    print("PARSE ERROR:", type(e).__name__, e)
    raise SystemExit(1)
kinds = Counter(type(s.stmt).__name__ for s in stmts)
tables = [s.stmt.relation.relname for s in stmts if type(s.stmt).__name__ == 'CreateStmt']
print(f"PARSE OK — {len(stmts)} statements")
for k, n in kinds.most_common():
    print(f"  {k}: {n}")
print(f"TABLES ({len(tables)}): {', '.join(tables)}")
