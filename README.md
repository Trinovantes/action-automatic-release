# Automatic Release

This is a fork of [marvinpinto/action-automatic-releases](https://github.com/marketplace/actions/automatic-releases) with a few minor tweaks for my personal use.

* File upload is decoupled from this action (see [Trinovantes/action-release-upload](https://github.com/Trinovantes/action-release-upload))
* GitHub secret token is taken in as an environment variable instead of input to be consistent with other actions (e.g. [actions/create-release](https://github.com/marketplace/actions/create-a-release))
* This action generates more outputs that may be of use for other actions (e.g. `upload_url`)

## Inputs

| Input                | Description                                                | Default  |
| -------------------- | ---------------------------------------------------------- | -------- |
| `auto_release_tag`   | Tag name to use for automatic releases, e.g `nightly`.     | `''`     |
| `auto_release_title` | Release title for automatic release e.g. `Nightly Build`   | `''`     |
| `is_draft`           | Mark this release as a draft?                              | `false`  |
| `is_prerelease`      | Mark this release as a pre-release?                        | `true`   |
| `branch`             | Git branch                                                 | `master` |

If `auto_release_tag` is set, then this action will delete the previous release with the same tag and recreate it with the current tag. Otherwise, this action will create a new release with the current tag.

## Outputs

| Output       | Description
| -------------| ---
| `tag`        | The release tag this action has just created/updated
| `prev_tag`   | The release tag this action has just upgraded from
| `release_id` | The id of the release this action has just created
| `upload_url` | The upload url of the release this action has just created

## Example Usage

```
- name: Update Nightly Build Release
  id: update_nightly
  uses: Trinovantes/action-automatic-release@v2.0.0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    auto_release_tag: nightly
    auto_release_title: Nightly Build
```
