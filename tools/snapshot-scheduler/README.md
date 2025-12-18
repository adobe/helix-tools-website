# Snapshot Scheduler

## Overview

Tool for scheduling snapshots in AEM Edge Delivery Services.

## Requirements

Has text fields for entering site & org and a button ti "Register". Upon success, show a success message. Upon failure, show a failure message. Follow authoriztion and error management patterns from other @tools (and also snapshot-admin specifically)

If successful - show a link to view all snapshots for given org/site by linking to /tools/snapshot-admin/index.html?org=<user-entered-org>&site=<user-entered-site>


## Implementation Notes

Follow the instructions in https://main--helix-website--adobe.aem.page/drafts/amol/scheduling for the implementation details. NOte that a pre-requisite of obtaining a API Key for the scheduler service by calling Admin API that has permissions to publish snapshots.


Sample API Key Request to automate:

Request:
```
POST https://admin.hlx.page/config/<org>/sites/<site>/apiKeys.json


{
  "description": "Key used for Publishing Scheduled Snapshots",
  "roles": [
    "publish"
  ]
}
```

Response:
```
{
    "description": "<same-description-from-request>",
    "roles": [
        "publish"
    ],
    "id": "<unique_id-returned>",
    "subject": "<org>/<site>",
    "expiration": "2026-11-24T18:10:34.000Z",
    "created": "2025-11-24T18:10:34.172Z",
    "value": "<use-this-value-in-the-register endpoint to register for scheduling>"
}
```