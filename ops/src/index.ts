/**
 * @jeesty/ops - Deployment and operations tools
 * 
 * Main entry point. Re-exports all public APIs.
 */

// Config
export { 
  opsConfig, 
  getProductionUrl,
  findProjectRoot,
  ensureProjectRoot,
  type OpsConfig,
  type OpsConfigAws,
  type OpsConfigContainer,
  type OpsConfigAuth,
  type OpsConfigDeployQuick as OpsConfigDeployQuick,
  type OpsConfigPersist
} from "./ops-config.js";

// Deploy (spec-compliant naming)
export { 
  deployQuick,
  deployCreateZip,
  deployPersist,
  deployStop,
  deployResume,
  deployStatus,
  deployWait,
  deployFull,
  type DeployQuickOptions,
  type DeployQuickResult,
  type DeployFullOptions,
  type DeployFullResult
} from "./deploy.js";

// Prerequisites
export {
  checkPrerequisites,
  type PrerequisiteCheckOptions,
  type PrerequisiteCheckResult
} from "./check-prerequisites.js";

// Secrets
export {
  loadSecrets,
  requireSecrets,
  type LoadSecretsOptions,
  type LoadSecretsResult
} from "./load-secrets.js";

// Docker
export {
  dockerBuild,
  dockerTag,
  isDockerRunning,
  getDockerVersion,
  type DockerBuildOptions,
  type DockerBuildResult,
  type DockerTagOptions
} from "./docker-build.js";

// Smoke Tests
export {
  checkHealth,
  waitForHealth,
  runNpmTest,
  runSmokeTests,
  type HealthCheckOptions,
  type SmokeTestOptions,
  type SmokeTestResult
} from "./smoke-tests.js";

// AWS ECR
export {
  getAwsAccountId,
  ecrLogin,
  ensureEcrRepository,
  ecrPush,
  pushToEcr,
  type EcrConfig,
  type EcrLoginResult,
  type EcrEnsureRepoResult,
  type EcrPushResult,
  type EcrPushOptions
} from "./aws-ecr.js";

// AWS S3 & IAM
export {
  ensureS3Bucket,
  ensureIamPolicy,
  ensureIamRole,
  attachPolicyToRole,
  ensureAppRunnerAccessRole,
  setupS3AndInstanceRole,
  type S3Config,
  type IamPolicyConfig,
  type IamRoleConfig,
  type EnsureResult,
  type SetupS3IamOptions,
  type SetupS3IamResult
} from "./aws-s3-iam.js";

// AWS App Runner
export {
  getServiceArn,
  getServiceStatus,
  getInProgressOperation,
  waitForOperation,
  deleteService,
  pauseService,
  resumeService,
  deployToAppRunner,
  type AppRunnerConfig,
  type AppRunnerServiceInfo,
  type AppRunnerOperationInfo,
  type AppRunnerDeployResult,
  type AppRunnerControlResult,
  type DeployToAppRunnerOptions
} from "./aws-apprunner.js";

// Remote Admin
export {
  authenticate,
  callAdminEndpoint,
  persistRemoteService,
  checkRemoteHealth,
  getRemoteUrl,
  type RemoteAdminOptions,
  type AuthSession,
  type AdminCallResult,
  type PersistResult
} from "./remote-admin.js";

// Service Control (high-level)
export {
  stopService,
  startService,
  getStatus,
  waitForService,
  type ServiceControlOptions,
  type ServiceControlResult,
  type ServiceStatusResult
} from "./service-control.js";
