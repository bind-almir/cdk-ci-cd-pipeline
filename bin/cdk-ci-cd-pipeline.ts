#!/usr/bin/env node
import 'source-map-support/register';
import cdk = require('@aws-cdk/core');
import { CdkCiCdPipelineStack } from '../lib/cdk-ci-cd-pipeline-stack';

const app = new cdk.App();
new CdkCiCdPipelineStack(app, 'CdkCiCdPipelineStack');
