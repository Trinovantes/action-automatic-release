/* eslint-disable camelcase */

export type GitHubTagResponse = {
    name: string
    zipball_url: string
    tarball_url: string
    commit: {
        sha: string
        url: string
    }
    node_id: string
}
