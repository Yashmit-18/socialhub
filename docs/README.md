# SocialHub documentation

Start with the [project README](../README.md) for setup, scripts and the project history.

## Deployment

| Document                                                                   | What it covers                                                                                                                                                |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [deployment/DEPLOYMENT.md](deployment/DEPLOYMENT.md)                       | Deploying step by step: website + API on Vercel (`vercel.json`), publishing worker + Redis on Render (`render.yaml`), Atlas, Cloudflare R2, Meta URLs, checks |
| [deployment/CHATGPT_DEPLOY_PROMPT.md](deployment/CHATGPT_DEPLOY_PROMPT.md) | A ready prompt that makes ChatGPT guide the deployment one step at a time                                                                                     |

## Architecture

| Document                           | What it covers                                |
| ---------------------------------- | --------------------------------------------- |
| [ARCHITECTURE.md](ARCHITECTURE.md) | Data model, service boundaries, phase designs |

## API contracts

| Document                                             | What it covers                                                                  |
| ---------------------------------------------------- | ------------------------------------------------------------------------------- |
| [COMPOSER_API_CONTRACT.md](COMPOSER_API_CONTRACT.md) | Composer drafts, media upload, presets; S3/R2 bucket setup and its verification |
| [PUBLISHING_API.md](PUBLISHING_API.md)               | Publishing engine: jobs, scheduling, queue, live publishing to Meta             |

## Features

| Document                                           | What it covers                                            |
| -------------------------------------------------- | --------------------------------------------------------- |
| [ACCOUNT_ORGANIZATION.md](ACCOUNT_ORGANIZATION.md) | Labels, stars, notes, All accounts tab, CSV export        |
| [ANALYTICS.md](ANALYTICS.md)                       | Analytics and insights sync (modes, queue, Meta insights) |
| [GROUP_SHARING.md](GROUP_SHARING.md)               | Facebook Group directory and manual sharing tasks         |

## Meta (Facebook and Instagram)

| Document                                             | What it covers                                             |
| ---------------------------------------------------- | ---------------------------------------------------------- |
| [META_SETUP_GUIDE.md](META_SETUP_GUIDE.md)           | Creating and configuring the Meta app; every dashboard URL |
| [META_APP_REVIEW_GUIDE.md](META_APP_REVIEW_GUIDE.md) | App Review, Business Verification, hosting for reviewers   |
| [PHASE2_VERIFICATION.md](PHASE2_VERIFICATION.md)     | Real-world verification runbook for the Meta integration   |
