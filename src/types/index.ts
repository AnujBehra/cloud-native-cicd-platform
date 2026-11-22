export type PipelineStatus = 'queued' | 'running' | 'passed' | 'failed' | 'cancelled' | 'rolled_back';

export type StageName = 
  | 'checkout' 
  | 'test' 
  | 'docker_build' 
  | 'helm_lint' 
  | 'k8s_deploy' 
  | 'health_check'
  | 'rollback';

export type StageStatus = 'pending' | 'running' | 'passed' | 'failed' | 'skipped';

export type TriggerType = 'github_push' | 'github_pr' | 'manual' | 'api' | 'schedule' | 'rollback';

export type Environment = 'development' | 'staging' | 'production';

export interface Project {
  id: string;
  name: string;
  repoUrl: string;
  defaultBranch: string;
  helmChartPath: string;
  dockerfilePath: string;
  environments: Environment[];
  webhookSecret?: string;
  createdAt: string;
  updatedAt: string;
}

export interface StageExecution {
  id: string;
  pipelineRunId: string;
  stageName: StageName;
  displayName: string;
  status: StageStatus;
  exitCode?: number;
  logs: string;
  startedAt?: string;
  finishedAt?: string;
  durationMs?: number;
}

export interface PipelineRun {
  id: string;
  projectId: string;
  projectName?: string;
  triggerType: TriggerType;
  branch: string;
  commitSha: string;
  commitMessage: string;
  author: string;
  status: PipelineStatus;
  targetEnvironment: Environment;
  imageTag?: string;
  helmReleaseName?: string;
  helmRevision?: number;
  stages: StageExecution[];
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
  error?: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  projectName: string;
  pipelineRunId: string;
  environment: Environment;
  helmReleaseName: string;
  helmRevision: number;
  imageTag: string;
  status: 'active' | 'superseded' | 'failed' | 'rolled_back';
  deployedAt: string;
  deployedBy: string;
  rolledBackFromRevision?: number;
  manifestsYaml?: string;
}

export interface HelmRelease {
  name: string;
  namespace: string;
  revision: number;
  updated: string;
  status: 'deployed' | 'superseded' | 'failed' | 'uninstalled';
  chart: string;
  appVersion: string;
  values: Record<string, any>;
  description?: string;
}

export interface K8sPod {
  name: string;
  namespace: string;
  status: 'Running' | 'Pending' | 'CrashLoopBackOff' | 'ContainerCreating' | 'Terminating' | 'Failed';
  ready: boolean;
  restarts: number;
  age: string;
  node: string;
  ip: string;
  cpuUsage: string;
  memoryUsage: string;
  labels: Record<string, string>;
}

export interface K8sService {
  name: string;
  namespace: string;
  type: 'ClusterIP' | 'NodePort' | 'LoadBalancer';
  clusterIp: string;
  externalIp?: string;
  ports: string;
  age: string;
}

export interface K8sDeploymentStatus {
  name: string;
  namespace: string;
  replicas: number;
  readyReplicas: number;
  availableReplicas: number;
  updatedReplicas: number;
  age: string;
  conditions: Array<{
    type: string;
    status: string;
    reason: string;
    message: string;
  }>;
}

export interface DoraMetrics {
  deploymentFrequency: {
    value: number;
    unit: string;
    rating: 'Elite' | 'High' | 'Medium' | 'Low';
    totalDeploymentsLast30Days: number;
  };
  leadTimeForChanges: {
    valueHours: number;
    formatted: string;
    rating: 'Elite' | 'High' | 'Medium' | 'Low';
  };
  changeFailureRate: {
    valuePercent: number;
    rating: 'Elite' | 'High' | 'Medium' | 'Low';
    failedDeployments: number;
    totalDeployments: number;
  };
  meanTimeToRestore: {
    valueMinutes: number;
    formatted: string;
    rating: 'Elite' | 'High' | 'Medium' | 'Low';
  };
}

export interface LogMessage {
  pipelineRunId: string;
  stageName: StageName;
  timestamp: string;
  level: 'info' | 'warn' | 'error' | 'success' | 'debug';
  message: string;
}
