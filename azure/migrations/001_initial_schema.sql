-- FlowSense Azure SQL Database Schema
-- Migrated from Supabase PostgreSQL

-- Profiles table
CREATE TABLE profiles (
    id UNIQUEIDENTIFIER PRIMARY KEY,
    full_name NVARCHAR(255) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE()
);

-- Analysis runs table
CREATE TABLE analysis_runs (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    user_id UNIQUEIDENTIFIER NOT NULL,
    title NVARCHAR(255) NOT NULL,
    video_storage_path NVARCHAR(500) NOT NULL,
    status NVARCHAR(20) NOT NULL DEFAULT 'uploaded'
        CONSTRAINT CHK_analysis_runs_status CHECK (
            status IN ('uploaded', 'queued', 'processing', 'cancel_requested', 'completed', 'failed', 'cancelled')
        ),
    cancel_requested BIT NOT NULL DEFAULT 0,
    error_message NVARCHAR(MAX) NULL,
    progress_percentage INT DEFAULT 0,
    progress_message NVARCHAR(255) NULL,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    updated_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_analysis_runs_user FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE
);

-- Frames table
CREATE TABLE frames (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    run_id UNIQUEIDENTIFIER NOT NULL,
    storage_path NVARCHAR(500) NOT NULL,
    timestamp_ms INT NOT NULL,
    is_keyframe BIT NOT NULL DEFAULT 0,
    diff_score FLOAT NOT NULL DEFAULT 0,
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_frames_run FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE
);

-- Frame analyses table (JSONB columns converted to NVARCHAR(MAX) with JSON validation)
CREATE TABLE frame_analyses (
    id UNIQUEIDENTIFIER PRIMARY KEY DEFAULT NEWID(),
    frame_id UNIQUEIDENTIFIER NOT NULL,
    rubric_scores NVARCHAR(MAX) NOT NULL,
    justifications NVARCHAR(MAX) NOT NULL,
    issue_tags NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    suggestions NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_frame_analyses_frame FOREIGN KEY (frame_id) REFERENCES frames(id) ON DELETE CASCADE,
    CONSTRAINT CHK_rubric_scores_json CHECK (ISJSON(rubric_scores) = 1),
    CONSTRAINT CHK_justifications_json CHECK (ISJSON(justifications) = 1),
    CONSTRAINT CHK_issue_tags_json CHECK (ISJSON(issue_tags) = 1),
    CONSTRAINT CHK_suggestions_json CHECK (ISJSON(suggestions) = 1)
);

-- Run summaries table
CREATE TABLE run_summaries (
    run_id UNIQUEIDENTIFIER PRIMARY KEY,
    overall_scores NVARCHAR(MAX) NOT NULL,
    top_issues NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    recommendations NVARCHAR(MAX) NOT NULL DEFAULT '[]',
    weighted_score_100 FLOAT NOT NULL DEFAULT 0,
    critical_issue_count INT NOT NULL DEFAULT 0,
    quality_gate_status NVARCHAR(10) NOT NULL DEFAULT 'warn'
        CONSTRAINT CHK_quality_gate_status CHECK (quality_gate_status IN ('pass', 'warn', 'block')),
    confidence_by_category NVARCHAR(MAX) NOT NULL DEFAULT '{"cat1":0.5,"cat2":0.5,"cat3":0.5,"cat4":0.5,"cat5":0.5,"cat6":0.5,"cat7":0.5}',
    metric_version NVARCHAR(20) NOT NULL DEFAULT 'v1',
    created_at DATETIME2 DEFAULT GETUTCDATE(),
    CONSTRAINT FK_run_summaries_run FOREIGN KEY (run_id) REFERENCES analysis_runs(id) ON DELETE CASCADE,
    CONSTRAINT CHK_overall_scores_json CHECK (ISJSON(overall_scores) = 1),
    CONSTRAINT CHK_top_issues_json CHECK (ISJSON(top_issues) = 1),
    CONSTRAINT CHK_recommendations_json CHECK (ISJSON(recommendations) = 1),
    CONSTRAINT CHK_confidence_by_category_json CHECK (ISJSON(confidence_by_category) = 1)
);

-- Create indexes for performance
CREATE INDEX idx_analysis_runs_user_id ON analysis_runs(user_id);
CREATE INDEX idx_analysis_runs_status ON analysis_runs(status);
CREATE INDEX idx_analysis_runs_created ON analysis_runs(created_at DESC);
CREATE INDEX idx_analysis_runs_cancel_requested ON analysis_runs(cancel_requested);
CREATE INDEX idx_frames_run_id ON frames(run_id);
CREATE INDEX idx_frames_is_keyframe ON frames(is_keyframe);
CREATE INDEX idx_frame_analyses_frame_id ON frame_analyses(frame_id);

-- Trigger for auto-updating updated_at timestamp
GO
CREATE TRIGGER trg_analysis_runs_updated_at
ON analysis_runs
AFTER UPDATE
AS
BEGIN
    SET NOCOUNT ON;
    UPDATE analysis_runs
    SET updated_at = GETUTCDATE()
    FROM analysis_runs ar
    INNER JOIN inserted i ON ar.id = i.id;
END;
GO
