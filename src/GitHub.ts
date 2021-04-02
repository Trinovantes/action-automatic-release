/* eslint-disable camelcase */

export interface IGitHubTagResponse {
    name: string
    zipball_url: string
    tarball_url: string
    commit: {
        sha: string
        url: string
    }
    node_id: string
}
