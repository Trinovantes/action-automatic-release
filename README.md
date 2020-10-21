# Automatic Release

This is a fork of [marvinpinto/action-automatic-releases](https://github.com/marketplace/actions/automatic-releases) with a few minor tweaks for my personal use.

* File upload is decoupled from this action (see [Trinovantes/action-release-upload](https://github.com/Trinovantes/action-release-upload))
* GitHub secret token is taken in as an environment variable instead to be consistent with other actions (e.g. [actions/create-release](https://github.com/marketplace/actions/create-a-release))
* This action generates more outputs that may be of use for other actions

## Inputs

| Input                   | Description                                                | Default  |
| ----------------------- | ---------------------------------------------------------- | -------- |
| `draft`                 | Mark this release as a draft?                              | `false`  |
| `prerelease`            | Mark this release as a pre-release?                        | `true`   |
| `automatic_release_tag` | Tag name to use for automatic releases, e.g `nightly`.     | `null`   |
| `title`                 | Release title for automatic release                        | Tag Name |

## Outputs

| Output       | Description
| -------------| ---
| `tag`        | The release tag this action just created/updated
| `prev_tag`   | The release tag this action just upgraded from
| `release_id` | The id of the release this action just created
| `upload_url` | The upload url of the release this action just created

## Example Usage

```
- name: Update Nightly Build Release
  id: update_nightly
  uses: Trinovantes/action-automatic-release@v1.0.0
  env:
    GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
  with:
    automatic_release_tag: nightly
    title: Nightly Build
```
