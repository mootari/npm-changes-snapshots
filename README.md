# npm-changes-snapshots
Creates a daily snapshot of npm's changes feed to verify claims of retroactive changes.

Each day a GitHub workflow records the latest state of every package in the [npm replication feed](https://replicate.npmjs.com/) and publishes it as a release, together with a summary of what changed compared to the previous day's snapshot.
