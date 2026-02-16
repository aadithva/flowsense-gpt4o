const sql = require('mssql');
const { DefaultAzureCredential } = require('@azure/identity');

async function runMigration() {
  const credential = new DefaultAzureCredential();
  const token = await credential.getToken('https://database.windows.net/.default');

  const config = {
    server: process.env.AZURE_SQL_SERVER || 'your-server.database.windows.net',
    database: process.env.AZURE_SQL_DATABASE || 'your-database',
    authentication: {
      type: 'azure-active-directory-access-token',
      options: { token: token.token }
    },
    options: {
      encrypt: true,
      trustServerCertificate: false,
    }
  };

  try {
    const pool = await sql.connect(config);
    console.log('Connected to Azure SQL');

    // Check if column exists
    const checkResult = await pool.request().query(`
      SELECT COLUMN_NAME
      FROM INFORMATION_SCHEMA.COLUMNS
      WHERE TABLE_NAME = 'analysis_runs' AND COLUMN_NAME = 'cancel_requested'
    `);

    if (checkResult.recordset.length === 0) {
      console.log('Adding cancel_requested column...');
      await pool.request().query(`
        ALTER TABLE analysis_runs ADD cancel_requested BIT NOT NULL DEFAULT 0
      `);
      console.log('Column added successfully');
    } else {
      console.log('Column already exists');
    }

    // Check and add run_summaries columns if missing
    const summaryColumns = [
      { name: 'weighted_score_100', type: 'DECIMAL(5,2)', default: '0' },
      { name: 'critical_issue_count', type: 'INT', default: '0' },
      { name: 'quality_gate_status', type: 'NVARCHAR(20)', default: "'pending'" },
      { name: 'confidence_by_category', type: 'NVARCHAR(MAX)', default: "'{}'" },
      { name: 'metric_version', type: 'NVARCHAR(20)', default: "'v2'" }
    ];

    for (const col of summaryColumns) {
      const check = await pool.request().query(`
        SELECT COLUMN_NAME
        FROM INFORMATION_SCHEMA.COLUMNS
        WHERE TABLE_NAME = 'run_summaries' AND COLUMN_NAME = '${col.name}'
      `);

      if (check.recordset.length === 0) {
        console.log(`Adding ${col.name} column to run_summaries...`);
        await pool.request().query(`
          ALTER TABLE run_summaries ADD ${col.name} ${col.type} NOT NULL DEFAULT ${col.default}
        `);
        console.log(`Column ${col.name} added`);
      }
    }

    console.log('Migration complete');
    await pool.close();
  } catch (err) {
    console.error('Migration error:', err);
    process.exit(1);
  }
}

runMigration();
