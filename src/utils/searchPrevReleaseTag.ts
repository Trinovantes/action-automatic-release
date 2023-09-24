import { valid as semverValid, rcompare as semverRcompare, lt as semverLt } from 'semver'
import { Octokit } from '@octokit/rest'

type GitHubRepo = {
    owner: string
    repo: string
}

type GitHubTagResponse = {
    name: string
    zipball_url: string
    tarball_url: string
    commit: {
        sha: string
        url: string
    }
    node_id: string
}

export async function searchPrevReleaseTag(ghClient: Octokit, ghRepo: GitHubRepo, currentTag: string): Promise<string | undefined> {
    const validSemver = semverValid(currentTag)
    if (!validSemver) {
        throw new Error(`The currentTag "${currentTag}" does not appear to conform to semantic versioning.`)
    }

    const listTagsOptions = ghClient.repos.listTags.endpoint.merge(ghRepo)
    const allTags = await ghClient.paginate(listTagsOptions) as Array<GitHubTagResponse>
    const semverTags = allTags
        .filter((tag) => semverValid(tag.name))
        .map((tag) => ({
            name: tag.name,
            semverName: tag.name,
        }))
        .sort((a, b) => semverRcompare(a.semverName, b.semverName))

    for (const tag of semverTags) {
        if (semverLt(tag.semverName, currentTag)) {
            return tag.name
        }
    }

    // There is no release tag before the currentTag
    return undefined
}
