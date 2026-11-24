-- FR-29 (#28): the months worked before this update (the pilot since go-live) get their monthly
-- spreadsheet too: one pending export per month that has a closed day or is closed, oldest
-- first. The queue writes them on the first start after the update (partial while the month
-- is open, final once it is closed). Runs once; system state, so no audit rows.
INSERT INTO `export_queue` (`kind`, `reference`, `status`, `attempts`, `created_at`)
SELECT 'monthly_spreadsheet', `year_month`, 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM (
  SELECT substr(`date`, 1, 7) AS `year_month` FROM `days` WHERE `status` = 'closed'
  UNION
  SELECT `year_month` FROM `months` WHERE `status` = 'closed'
)
ORDER BY `year_month`;
