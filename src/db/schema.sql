-- ShipOps PostgreSQL Schema
-- Production Relational Database for CI/CD Deployment Platform

CREATE TABLE IF NOT EXISTS projects (
    id VARCHAR(64) PRIMARY KEY,
    name VARCHAR(255) NOT NULL UNIQUE,
    repo_url VARCHAR(512) NOT NULL,
    default_branch VARCHAR(128) DEFAULT 'main',
    helm_chart_path VARCHAR(512) DEFAULT 'charts/app',
    dockerfile_path VARCHAR(512) DEFAULT 'Dockerfile',
    environments JSONB DEFAULT '["development", "staging", "production"]',
    webhook_secret VARCHAR(255),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pipeline_runs (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    trigger_type VARCHAR(64) NOT NULL,
    branch VARCHAR(128) NOT NULL,
    commit_sha VARCHAR(64) NOT NULL,
    commit_message TEXT NOT NULL,
    author VARCHAR(255) NOT NULL,
    status VARCHAR(64) NOT NULL,
    target_environment VARCHAR(64) NOT NULL,
    image_tag VARCHAR(255),
    helm_release_name VARCHAR(255),
    helm_revision INTEGER,
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    duration_ms BIGINT,
    error TEXT
);

CREATE TABLE IF NOT EXISTS stage_executions (
    id VARCHAR(64) PRIMARY KEY,
    pipeline_run_id VARCHAR(64) REFERENCES pipeline_runs(id) ON DELETE CASCADE,
    stage_name VARCHAR(64) NOT NULL,
    display_name VARCHAR(128) NOT NULL,
    status VARCHAR(64) NOT NULL,
    exit_code INTEGER DEFAULT 0,
    logs TEXT DEFAULT '',
    started_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    finished_at TIMESTAMP WITH TIME ZONE,
    duration_ms BIGINT
);

CREATE TABLE IF NOT EXISTS deployments (
    id VARCHAR(64) PRIMARY KEY,
    project_id VARCHAR(64) REFERENCES projects(id) ON DELETE CASCADE,
    project_name VARCHAR(255) NOT NULL,
    pipeline_run_id VARCHAR(64) REFERENCES pipeline_runs(id) ON DELETE SET NULL,
    environment VARCHAR(64) NOT NULL,
    helm_release_name VARCHAR(255) NOT NULL,
    helm_revision INTEGER NOT NULL,
    image_tag VARCHAR(255) NOT NULL,
    status VARCHAR(64) NOT NULL,
    deployed_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    deployed_by VARCHAR(255) NOT NULL,
    rolled_back_from_revision INTEGER,
    manifests_yaml TEXT
);

CREATE TABLE IF NOT EXISTS helm_releases (
    name VARCHAR(255) NOT NULL,
    namespace VARCHAR(128) NOT NULL,
    revision INTEGER NOT NULL,
    updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    status VARCHAR(64) NOT NULL,
    chart VARCHAR(255) NOT NULL,
    app_version VARCHAR(128) NOT NULL,
    values JSONB DEFAULT '{}',
    description TEXT,
    PRIMARY KEY (name, namespace, revision)
);

CREATE TABLE IF NOT EXISTS audit_logs (
    id VARCHAR(64) PRIMARY KEY,
    action VARCHAR(128) NOT NULL,
    actor VARCHAR(255) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id VARCHAR(64) NOT NULL,
    details JSONB DEFAULT '{}',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Indexes for high-throughput queries
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_project_id ON pipeline_runs(project_id);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_status ON pipeline_runs(status);
CREATE INDEX IF NOT EXISTS idx_pipeline_runs_created_at ON pipeline_runs(started_at DESC);
CREATE INDEX IF NOT EXISTS idx_stage_executions_pipeline_id ON stage_executions(pipeline_run_id);
CREATE INDEX IF NOT EXISTS idx_deployments_project_env ON deployments(project_id, environment);
CREATE INDEX IF NOT EXISTS idx_deployments_deployed_at ON deployments(deployed_at DESC);
