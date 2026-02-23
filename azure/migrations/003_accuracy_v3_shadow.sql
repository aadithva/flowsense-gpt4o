-- FlowSense V3 Accuracy Upgrade Migration
-- Day 8: Data Model + API + UI Integration
-- Adds versioned summaries table, V3 diagnostics columns, and benchmark tables

-- =============================================================================
-- 1. Add V3 columns to existing run_summaries table (backward compatible)
-- =============================================================================

-- Analysis engine version
IF COL_LENGTH('run_summaries', 'analysis_engine_version') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD analysis_engine_version NVARCHAR(20) NOT NULL
        CONSTRAINT DF_run_summaries_analysis_engine_version DEFAULT 'v2_baseline';
END
GO

-- Analysis truncation flag
IF COL_LENGTH('run_summaries', 'analysis_truncated') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD analysis_truncated BIT NOT NULL
        CONSTRAINT DF_run_summaries_analysis_truncated DEFAULT 0;
END
GO

-- Frames skipped due to truncation
IF COL_LENGTH('run_summaries', 'frames_skipped') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD frames_skipped INT NOT NULL
        CONSTRAINT DF_run_summaries_frames_skipped DEFAULT 0;
END
GO

-- Frames analyzed
IF COL_LENGTH('run_summaries', 'frames_analyzed') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD frames_analyzed INT NOT NULL
        CONSTRAINT DF_run_summaries_frames_analyzed DEFAULT 0;
END
GO

-- V3 diagnostics JSON (evidence_coverage, self_consistency, token_usage, etc.)
IF COL_LENGTH('run_summaries', 'v3_diagnostics') IS NULL
BEGIN
    ALTER TABLE run_summaries ADD v3_diagnostics NVARCHAR(MAX) NULL;
END
GO

-- Add JSON constraint for v3_diagnostics
IF NOT EXISTS (SELECT 1 FROM sys.check_constraints WHERE name = 'CHK_v3_diagnostics_json')
BEGIN
    ALTER TABLE run_summaries
    ADD CONSTRAINT CHK_v3_diagnostics_json CHECK (v3_diagnostics IS NULL OR ISJSON(v3_diagnostics) = 1);
END
GO

-- =============================================================================
-- 2. Create run_summaries_versions table for shadow analysis comparison
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'run_summaries_versions')
BEGIN
    CREATE TABLE run_summaries_versions (
        -- Composite primary key
        run_id UNIQUEIDENTIFIER NOT NULL,
        analysis_engine_version NVARCHAR(20) NOT NULL,

        -- V2 compatible fields
        overall_scores NVARCHAR(MAX) NOT NULL,
        top_issues NVARCHAR(MAX) NOT NULL DEFAULT '[]',
        recommendations NVARCHAR(MAX) NOT NULL DEFAULT '[]',
        weighted_score_100 FLOAT NOT NULL DEFAULT 0,
        critical_issue_count INT NOT NULL DEFAULT 0,
        quality_gate_status NVARCHAR(10) NOT NULL DEFAULT 'warn',
        confidence_by_category NVARCHAR(MAX) NOT NULL DEFAULT '{"cat1":0.5,"cat2":0.5,"cat3":0.5,"cat4":0.5,"cat5":0.5,"cat6":0.5,"cat7":0.5}',
        metric_version NVARCHAR(20) NOT NULL DEFAULT 'v2',

        -- V3 diagnostics fields
        analysis_truncated BIT NOT NULL DEFAULT 0,
        frames_skipped INT NOT NULL DEFAULT 0,
        frames_analyzed INT NOT NULL DEFAULT 0,
        v3_diagnostics NVARCHAR(MAX) NULL,

        -- Shadow comparison metadata
        is_shadow BIT NOT NULL DEFAULT 0,
        shadow_sample_rate FLOAT NULL,

        -- Timestamps
        created_at DATETIME2 DEFAULT GETUTCDATE(),

        -- Primary key
        CONSTRAINT PK_run_summaries_versions PRIMARY KEY (run_id, analysis_engine_version),

        -- Foreign key
        CONSTRAINT FK_run_summaries_versions_run FOREIGN KEY (run_id)
            REFERENCES analysis_runs(id) ON DELETE CASCADE,

        -- JSON constraints
        CONSTRAINT CHK_rsv_overall_scores_json CHECK (ISJSON(overall_scores) = 1),
        CONSTRAINT CHK_rsv_top_issues_json CHECK (ISJSON(top_issues) = 1),
        CONSTRAINT CHK_rsv_recommendations_json CHECK (ISJSON(recommendations) = 1),
        CONSTRAINT CHK_rsv_confidence_json CHECK (ISJSON(confidence_by_category) = 1),
        CONSTRAINT CHK_rsv_v3_diagnostics_json CHECK (v3_diagnostics IS NULL OR ISJSON(v3_diagnostics) = 1),

        -- Value constraints
        CONSTRAINT CHK_rsv_quality_gate_status CHECK (quality_gate_status IN ('pass', 'warn', 'block')),
        CONSTRAINT CHK_rsv_analysis_engine_version CHECK (analysis_engine_version IN ('v2_baseline', 'v3_hybrid'))
    );

    -- Index for querying by run_id
    CREATE INDEX idx_rsv_run_id ON run_summaries_versions(run_id);

    -- Index for querying shadow results
    CREATE INDEX idx_rsv_is_shadow ON run_summaries_versions(is_shadow) WHERE is_shadow = 1;
END
GO

-- =============================================================================
-- 3. Create benchmark tables for accuracy evaluation
-- =============================================================================

-- Benchmark cases: curated video clips for evaluation
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'benchmark_cases')
BEGIN
    CREATE TABLE benchmark_cases (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        case_name NVARCHAR(255) NOT NULL,
        description NVARCHAR(MAX) NULL,
        video_storage_path NVARCHAR(500) NOT NULL,
        category NVARCHAR(50) NOT NULL,
        difficulty NVARCHAR(20) NOT NULL DEFAULT 'medium',
        expected_issues NVARCHAR(MAX) NOT NULL DEFAULT '[]',
        metadata NVARCHAR(MAX) NULL,
        is_active BIT NOT NULL DEFAULT 1,
        created_at DATETIME2 DEFAULT GETUTCDATE(),
        updated_at DATETIME2 DEFAULT GETUTCDATE(),

        CONSTRAINT CHK_bc_expected_issues_json CHECK (ISJSON(expected_issues) = 1),
        CONSTRAINT CHK_bc_metadata_json CHECK (metadata IS NULL OR ISJSON(metadata) = 1),
        CONSTRAINT CHK_bc_difficulty CHECK (difficulty IN ('easy', 'medium', 'hard', 'expert')),
        CONSTRAINT CHK_bc_category CHECK (category IN (
            'action_response', 'feedback_visibility', 'affordance',
            'flow_continuity', 'error_handling', 'micro_interaction', 'efficiency'
        ))
    );

    CREATE UNIQUE INDEX idx_bc_case_name ON benchmark_cases(case_name);
    CREATE INDEX idx_bc_category ON benchmark_cases(category);
    CREATE INDEX idx_bc_is_active ON benchmark_cases(is_active) WHERE is_active = 1;
END
GO

-- Benchmark labels: expert annotations for frames
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'benchmark_labels')
BEGIN
    CREATE TABLE benchmark_labels (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        benchmark_case_id UNIQUEIDENTIFIER NOT NULL,
        frame_timestamp_ms INT NOT NULL,
        labeler_id NVARCHAR(100) NOT NULL,
        rubric_scores NVARCHAR(MAX) NOT NULL,
        issue_tags NVARCHAR(MAX) NOT NULL DEFAULT '[]',
        justifications NVARCHAR(MAX) NULL,
        confidence FLOAT NOT NULL DEFAULT 1.0,
        notes NVARCHAR(MAX) NULL,
        created_at DATETIME2 DEFAULT GETUTCDATE(),

        CONSTRAINT FK_bl_benchmark_case FOREIGN KEY (benchmark_case_id)
            REFERENCES benchmark_cases(id) ON DELETE CASCADE,
        CONSTRAINT CHK_bl_rubric_scores_json CHECK (ISJSON(rubric_scores) = 1),
        CONSTRAINT CHK_bl_issue_tags_json CHECK (ISJSON(issue_tags) = 1),
        CONSTRAINT CHK_bl_justifications_json CHECK (justifications IS NULL OR ISJSON(justifications) = 1),
        CONSTRAINT CHK_bl_confidence CHECK (confidence >= 0 AND confidence <= 1)
    );

    CREATE INDEX idx_bl_benchmark_case_id ON benchmark_labels(benchmark_case_id);
    CREATE INDEX idx_bl_labeler_id ON benchmark_labels(labeler_id);
    CREATE UNIQUE INDEX idx_bl_case_frame_labeler ON benchmark_labels(benchmark_case_id, frame_timestamp_ms, labeler_id);
END
GO

-- Benchmark adjudications: resolved disagreements between labelers
IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'benchmark_adjudications')
BEGIN
    CREATE TABLE benchmark_adjudications (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        benchmark_case_id UNIQUEIDENTIFIER NOT NULL,
        frame_timestamp_ms INT NOT NULL,
        adjudicator_id NVARCHAR(100) NOT NULL,
        final_rubric_scores NVARCHAR(MAX) NOT NULL,
        final_issue_tags NVARCHAR(MAX) NOT NULL DEFAULT '[]',
        reasoning NVARCHAR(MAX) NULL,
        label_ids_considered NVARCHAR(MAX) NOT NULL DEFAULT '[]',
        created_at DATETIME2 DEFAULT GETUTCDATE(),

        CONSTRAINT FK_ba_benchmark_case FOREIGN KEY (benchmark_case_id)
            REFERENCES benchmark_cases(id) ON DELETE CASCADE,
        CONSTRAINT CHK_ba_final_rubric_scores_json CHECK (ISJSON(final_rubric_scores) = 1),
        CONSTRAINT CHK_ba_final_issue_tags_json CHECK (ISJSON(final_issue_tags) = 1),
        CONSTRAINT CHK_ba_label_ids_json CHECK (ISJSON(label_ids_considered) = 1)
    );

    CREATE INDEX idx_ba_benchmark_case_id ON benchmark_adjudications(benchmark_case_id);
    CREATE UNIQUE INDEX idx_ba_case_frame ON benchmark_adjudications(benchmark_case_id, frame_timestamp_ms);
END
GO

-- =============================================================================
-- 4. Create benchmark evaluation runs table
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'benchmark_evaluation_runs')
BEGIN
    CREATE TABLE benchmark_evaluation_runs (
        id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
        benchmark_case_id UNIQUEIDENTIFIER NOT NULL,
        analysis_engine_version NVARCHAR(20) NOT NULL,
        run_id UNIQUEIDENTIFIER NULL,

        -- Accuracy metrics
        mae_per_category NVARCHAR(MAX) NULL,
        overall_mae FLOAT NULL,
        issue_precision FLOAT NULL,
        issue_recall FLOAT NULL,
        issue_f1 FLOAT NULL,

        -- Execution metadata
        total_tokens INT NULL,
        inference_ms INT NULL,
        evaluation_notes NVARCHAR(MAX) NULL,

        created_at DATETIME2 DEFAULT GETUTCDATE(),

        CONSTRAINT FK_ber_benchmark_case FOREIGN KEY (benchmark_case_id)
            REFERENCES benchmark_cases(id) ON DELETE CASCADE,
        CONSTRAINT FK_ber_run FOREIGN KEY (run_id)
            REFERENCES analysis_runs(id) ON DELETE SET NULL,
        CONSTRAINT CHK_ber_mae_json CHECK (mae_per_category IS NULL OR ISJSON(mae_per_category) = 1),
        CONSTRAINT CHK_ber_engine_version CHECK (analysis_engine_version IN ('v2_baseline', 'v3_hybrid'))
    );

    CREATE INDEX idx_ber_benchmark_case_id ON benchmark_evaluation_runs(benchmark_case_id);
    CREATE INDEX idx_ber_engine_version ON benchmark_evaluation_runs(analysis_engine_version);
END
GO

-- =============================================================================
-- 5. Add trigger for updated_at on benchmark_cases
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.triggers WHERE name = 'trg_benchmark_cases_updated_at')
BEGIN
    EXEC('
    CREATE TRIGGER trg_benchmark_cases_updated_at
    ON benchmark_cases
    AFTER UPDATE
    AS
    BEGIN
        SET NOCOUNT ON;
        UPDATE benchmark_cases
        SET updated_at = GETUTCDATE()
        FROM benchmark_cases bc
        INNER JOIN inserted i ON bc.id = i.id;
    END;
    ');
END
GO

-- =============================================================================
-- 6. Create shadow_run_records table for monitoring V2 vs V3 comparison
-- =============================================================================

IF NOT EXISTS (SELECT 1 FROM sys.tables WHERE name = 'shadow_run_records')
BEGIN
    CREATE TABLE shadow_run_records (
        id UNIQUEIDENTIFIER NOT NULL DEFAULT NEWID() PRIMARY KEY,
        run_id UNIQUEIDENTIFIER NOT NULL,
        timestamp DATETIME2 NOT NULL,

        -- Engine versions
        primary_engine NVARCHAR(50) NOT NULL,
        shadow_engine NVARCHAR(50) NOT NULL,

        -- Success flags
        primary_success BIT NOT NULL,
        shadow_success BIT NOT NULL,

        -- Truncation tracking
        primary_truncated BIT NOT NULL DEFAULT 0,
        shadow_truncated BIT NOT NULL DEFAULT 0,
        primary_frames_skipped INT NOT NULL DEFAULT 0,
        shadow_frames_skipped INT NOT NULL DEFAULT 0,

        -- Score comparison
        primary_weighted_score FLOAT NULL,
        shadow_weighted_score FLOAT NULL,
        primary_critical_issues INT NULL,
        shadow_critical_issues INT NULL,

        -- Quality gate comparison
        primary_quality_gate NVARCHAR(10) NULL,
        shadow_quality_gate NVARCHAR(10) NULL,
        gate_changed BIT NOT NULL DEFAULT 0,

        -- Deltas
        weighted_score_delta FLOAT NULL,
        critical_issue_delta INT NULL,

        -- Token usage
        primary_tokens INT NOT NULL DEFAULT 0,
        shadow_tokens INT NOT NULL DEFAULT 0,

        created_at DATETIME2 NOT NULL DEFAULT GETUTCDATE(),

        -- Foreign key (optional - run may be deleted)
        -- CONSTRAINT FK_srr_run FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,

        -- Value constraints
        CONSTRAINT CHK_srr_primary_quality_gate CHECK (primary_quality_gate IS NULL OR primary_quality_gate IN ('pass', 'warn', 'block')),
        CONSTRAINT CHK_srr_shadow_quality_gate CHECK (shadow_quality_gate IS NULL OR shadow_quality_gate IN ('pass', 'warn', 'block'))
    );

    -- Index for time-based queries (monitoring dashboards)
    CREATE INDEX idx_srr_timestamp ON shadow_run_records(timestamp);

    -- Index for run lookups
    CREATE INDEX idx_srr_run_id ON shadow_run_records(run_id);

    -- Index for gate change queries
    CREATE INDEX idx_srr_gate_changed ON shadow_run_records(gate_changed) WHERE gate_changed = 1;

    -- Index for success/failure analysis
    CREATE INDEX idx_srr_success ON shadow_run_records(primary_success, shadow_success);
END
GO

PRINT 'V3 Accuracy Upgrade migration completed successfully';
GO
