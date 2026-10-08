# npm-changes-snapshots
Creates a daily snapshot of npm's changes feed to verify claims of retroactive changes.

Each day a GitHub workflow publishes a release containing the most recent changes feed entry of every package in the [npm replication feed](https://replicate.npmjs.com/), along with a count of added, removed, updated and retroactively changed entries compared to the previous snapshot.
