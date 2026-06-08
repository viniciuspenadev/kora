WITH blue AS (SELECT id FROM tenants WHERE name ILIKE '%blue%' LIMIT 1)
SELECT 'tenant' AS kind, (SELECT id::text FROM blue) AS id, (SELECT name FROM tenants WHERE id=(SELECT id FROM blue)) AS label
UNION ALL SELECT 'dept', id::text, name FROM tenant_departments WHERE tenant_id=(SELECT id FROM blue)
UNION ALL SELECT 'stage', id::text, name FROM pipeline_stages WHERE tenant_id=(SELECT id FROM blue)
UNION ALL SELECT 'flow', id::text, name||' ['||status||(CASE WHEN active THEN ' ATIVO' ELSE '' END)||']' FROM studio_flows WHERE tenant_id=(SELECT id FROM blue)
ORDER BY 1;