-- FR-28 (#21): the days closed before this update (the pilot since go-live) get their daily
-- spreadsheet too: one pending export per closed day, oldest first. The queue writes them on
-- the first start after the update. Runs once; system state, so no audit rows.
-- A day without movement is completed by the queue without a file (A-15).
INSERT INTO `export_queue` (`kind`, `reference`, `status`, `attempts`, `created_at`)
SELECT 'daily_spreadsheet', `date`, 'pending', 0, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
FROM `days`
WHERE `status` = 'closed'
ORDER BY `date`;
