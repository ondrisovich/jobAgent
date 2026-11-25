# Daily job search workflow

1. Create a scheduled task in Codex. Search job boards and employer career pages in Czechia, Switzerland, Germany, Austria, and the rest of Europe. Use combinations of PLC, SCADA, DCS, WinCC OA, OPC UA, industrial control systems, process control, and commissioning. Search in the local language where relevant. Include B2B and offshore rotation contracts in the European search.
2. Verify each original listing and keep a single result for each role. Write the batch using [the example format](jobs.example.json).
3. Run `node sync-jobs.mjs <batch.json>` and check the counts for each region.
4. Review older listings. Keep temporarily unavailable or ambiguous results. Put exact URLs of confirmed closed listings into a separate JSON array.
5. Run `node sync-jobs.mjs <empty-batch.json> <closed-urls.json>` and check the removal count. The first input for this step contains `[]`.
