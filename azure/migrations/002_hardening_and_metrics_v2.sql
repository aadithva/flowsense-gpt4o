-- FlowSense hardening migration: cancellation state + metric V2 fields

IF COL_LENGTH('analysis_runs', 'cancel_requested') IS NULL
BEGIN
    ALTER TABLE analysis_runs
    ADD cancel_requested BIT NOT NULL CONSTRAINT DF_analysis_runs_cancel_requested DEFAULT 0;
END
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_analysis_runs_status')
BEGIN
    ALTER TABLE analysis_runs DROP CONSTRAINT CHK_analysis_runs_status;
END
GO

ALTER TABLE analysis_runs
ADD CONSTRAINT CHK_analysis_runs_status CHECK (
    status IN ('uploaded', 'queued', 'processing', 'cancel_requested', 'completed', 'failed', 'cancelled')
);
GO

IF NOT EXISTS (SELECT 1 FROM sys.indexes WHERE name = 'idx_analysis_runs_cancel_requested')
BEGIN
    CREATE INDEX idx_analysis_runs_cancel_requested ON analysis_runs(cancel_requested);
END
GO

IF COL_LENGTH('run_summaries', 'weighted_score_100') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD weighted_score_100 FLOAT NOT NULL CONSTRAINT DF_run_summaries_weighted_score DEFAULT 0;
END
GO

IF COL_LENGTH('run_summaries', 'critical_issue_count') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD critical_issue_count INT NOT NULL CONSTRAINT DF_run_summaries_critical_issue_count DEFAULT 0;
END
GO

IF COL_LENGTH('run_summaries', 'quality_gate_status') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD quality_gate_status NVARCHAR(10) NOT NULL CONSTRAINT DF_run_summaries_quality_gate_status DEFAULT 'warn';
END
GO

IF COL_LENGTH('run_summaries', 'confidence_by_category') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD confidence_by_category NVARCHAR(MAX) NOT NULL CONSTRAINT DF_run_summaries_confidence_by_category DEFAULT '{"cat1":0.5,"cat2":0.5,"cat3":0.5,"cat4":0.5,"cat5":0.5,"cat6":0.5,"cat7":0.5}';
END
GO

IF COL_LENGTH('run_summaries', 'metric_version') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD metric_version NVARCHAR(20) NOT NULL CONSTRAINT DF_run_summaries_metric_version DEFAULT 'v1';
END
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_quality_gate_status')
BEGIN
    ALTER TABLE run_summaries DROP CONSTRAINT CHK_quality_gate_status;
END
GO

ALTER TABLE run_summaries
ADD CONSTRAINT CHK_quality_gate_status CHECK (quality_gate_status IN ('pass', 'warn', 'block'));
GO

IF EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_confidence_by_category_json')
BEGIN
    ALTER TABLE run_summaries DROP CONSTRAINT CHK_confidence_by_category_json;
END
GO

ALTER TABLE run_summaries
ADD CONSTRAINT CHK_confidence_by_category_json CHECK (ISJSON(confidence_by_category) = 1);
GO
