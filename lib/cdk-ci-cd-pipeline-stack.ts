import cdk = require('@aws-cdk/core');
import { Bucket } from '@aws-cdk/aws-s3';
import { CloudFrontWebDistribution, SSLMethod, SecurityPolicyProtocol } from '@aws-cdk/aws-cloudfront';
import { DnsValidatedCertificate } from '@aws-cdk/aws-certificatemanager'
import { HostedZone, AddressRecordTarget, ARecord } from '@aws-cdk/aws-route53';
import { CloudFrontTarget } from '@aws-cdk/aws-route53-targets';
import { Pipeline, Artifact } from '@aws-cdk/aws-codepipeline';
import { GitHubSourceAction, GitHubTrigger, CodeBuildAction } from '@aws-cdk/aws-codepipeline-actions';
import { Project, BuildSpec } from '@aws-cdk/aws-codebuild';
import { Role, ServicePrincipal, ManagedPolicy} from '@aws-cdk/aws-iam';
import { RemovalPolicy, SecretValue, StackProps } from '@aws-cdk/core';

export interface PipelineStackProps  extends StackProps {
  domainName: string;
}

export class CdkCiCdPipelineStack extends cdk.Stack {
  constructor(scope: cdk.Construct, id: string, props: PipelineStackProps) {
    super(scope, id, props);

    const hostedZone = HostedZone.fromLookup(this, 'Domain', {
      domainName: props.domainName,
      privateZone: false
      
    });
    
    const frontendCertificate = new DnsValidatedCertificate(this, 'WebAppCertificate', {
      domainName: props.domainName,
      hostedZone,
      region: 'us-east-1'
    });  // certificate region MUST be us-east-1

    const siteBucket = new Bucket(this, 'SiteBucket', {
      bucketName: props.domainName,
      websiteIndexDocument: 'index.html',
      websiteErrorDocument: 'error.html',
      publicReadAccess: true,
      removalPolicy: RemovalPolicy.DESTROY,
      blockPublicAccess: {
        restrictPublicBuckets: false,
        blockPublicAcls: false,
        ignorePublicAcls: false,
        blockPublicPolicy: false
      }
    });

    const distribution = new CloudFrontWebDistribution(this, 'WebAppDistribution', {
      aliasConfiguration: {
        acmCertRef: frontendCertificate.certificateArn,
        names: [props.domainName],
        sslMethod: SSLMethod.SNI,
        securityPolicy: SecurityPolicyProtocol.TLS_V1_1_2016,
      },
      originConfigs: [
        {
          s3OriginSource: {
            s3BucketSource: siteBucket
          },
          behaviors: [{ isDefaultBehavior: true }],
        }
      ],
      errorConfigurations: [
        {
          errorCode: 404,
          errorCachingMinTtl: 300,
          responseCode: 200,
          responsePagePath: '/index.html'
        },
        {
          errorCode: 403,
          errorCachingMinTtl: 300,
          responseCode: 200,
          responsePagePath: '/index.html'
        }
      ]
    });

    new ARecord(this, 'ARecord', {
      recordName: props.domainName,
      zone: hostedZone,
      target: AddressRecordTarget.fromAlias(new CloudFrontTarget(distribution)),
    });

    const pipeline = new Pipeline(this, 'FrontendPipeline', {
      pipelineName: 'deploy-angular-application',
    });
  
    // add Stages
  
    const sourceStage = pipeline.addStage({
      stageName: 'Source'
    });
  
    const buildStage = pipeline.addStage({
      stageName: 'Build',
      placement: {
        justAfter: sourceStage
      }
    });

    const sourceOutput = new Artifact();
    const sourceAction = new GitHubSourceAction({
      actionName: 'GitHub',
      owner: 'bind-almir',
      repo: 'angular-app',
      oauthToken: SecretValue.secretsManager('cdk-pipeline-example'),
      output: sourceOutput,
      branch: 'master', 
      trigger: GitHubTrigger.POLL // default: 'WEBHOOK', 'NONE' is also possible for no Source trigger
    });
  
    sourceStage.addAction(sourceAction);

    const role = new Role(this, 'CodeBuildRole', {
      assumedBy: new ServicePrincipal('codebuild.amazonaws.com'),
      managedPolicies: [
        ManagedPolicy.fromAwsManagedPolicyName('AmazonS3FullAccess'),
        ManagedPolicy.fromAwsManagedPolicyName('CloudFrontFullAccess')
      ]
    });

    const codeBuild = new Project(this, 'CodeBuildProject', {
      role,
      buildSpec: BuildSpec.fromObject({
        "version": 0.2,
        "phases": {
          "install": {
            "runtime-versions": {
              "nodejs": 10
            },
            "commands": [
              "echo installing dependencies",
              "npm install",
              "echo installing aws cli",
              "pip install awscli --upgrade --user",
              "echo check version",
              "aws --version",
              "echo installing angular cli",
              "npm i -g @angular/cli"
            ]
          },
          "build": {
            "commands": [
              "echo Build started on `date`",
              "echo Building angular-app",
              "ng build --prod"
            ],
            "artifacts": {
              "files": [
                "**/*"
              ],
              "base-directory": "dist/angular-app",
              "discard-paths": "yes"
            }
          },
          "post_build": {
            "commands": [
              "echo BUILD COMPLETE running sync with s3",
              `aws s3 rm s3://${props.domainName}/ --recursive`,
              `aws s3 cp ./dist/angular-app s3://${props.domainName}/ --recursive --grants read=uri=http://acs.amazonaws.com/groups/global/AllUsers`,
              `aws cloudfront create-invalidation --distribution-id ${distribution.distributionId} --paths "/*"`
            ]
          }
        }
      })
    });

    const buildAction = new CodeBuildAction({
      actionName: 'Build',
      input: sourceOutput,
      project: codeBuild
    });
    
    buildStage.addAction(buildAction);

  }
}
