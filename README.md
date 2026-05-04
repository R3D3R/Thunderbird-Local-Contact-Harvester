# Local Contact Harvester

Local Contact Harvester is a Thunderbird/Betterbird extension that scans selected mail folders locally and extracts contact information from message headers and message bodies. It is designed for offline/local research workflows and exports the results as CSV.

## Features

- Select a mail account from Thunderbird's account list.
- Load folders for that account and scan only the folders you choose.
- Optionally include subfolders when a parent folder is selected.
- Skip messages from `@cy.gt.com`.
- Extract sender name, email, and a best-effort role/title from signatures and nearby text.
- Export results as a local CSV file.

## How it works

The extension uses Thunderbird's `accountsRead` permission to see mail accounts and folders, and `messagesRead` to access message data.
It scans message lists with `messages.list()` and, when needed, fetches full message content with `messages.getFull()` to improve contact extraction.
The output is deduplicated by account, folder/company, and email address to reduce repeated rows.

## Permissions

- `accountsRead` — required to list accounts, identities, and folders.
- `messagesRead` — required to read mail messages and message content.
- `downloads` — required to save the CSV export locally.

## Installation

1. Open Thunderbird or Betterbird.
2. Open the Add-ons Manager.
3. Install the extension temporarily or load the packaged `.xpi`.
4. Open the extension popup from the toolbar.
5. Select an account, load folders, choose the folders you want, and run the scan.

## Usage

1. Click **Reload accounts** if the account list is empty or stale.
2. Select one account.
3. Click **Load folders**.
4. Tick the folders you want to scan.
5. Leave **Include subfolders** enabled if you want recursive scanning.
6. Click **Scan selected folders** and save the CSV when prompted.

## Output fields

The CSV contains these columns:

- `account_name`
- `company_name`
- `display_name`
- `email`
- `position`
- `confidence`
- `messages_seen`
- `source_folder`
- `signature_snippet`

## Notes

- The extension works locally inside Thunderbird; it does not send your mail data to a remote server.
- Role detection is heuristic and best-effort; it is most accurate when the sender's signature includes an explicit job title.
- If a folder returns no visible messages through the API, it will not produce rows.

## Development

This repository is meant to stay simple and readable. If you modify the extension, keep the account-selection flow stable and avoid adding extra message-passing layers unless necessary, because Thunderbird background-page availability depends on the extension structure.

## License

Choose a license that matches your intended redistribution and contribution policy.
