import * as core from '@actions/core'
import { valid as semverValid, rcompare as semverRcompare, lt as semverLt } from 'semver'
import type { GitHubTagResponse } from './GitHub'
import type { GitHub } from '@actions/github/lib/utils'
import type { Octokit } from '@octokit/rest'

export type GitHubClient = InstanceType<typeof GitHub>
export type GitHubRepo = { owner: string; repo: string }

export function exportOutput(name: string, value: string | number): void {
    core.info(`Exporting env variable ${name}=${value}`)
    core.exportVariable(name.toUpperCase(), value)
    core.setOutput(name.toLowerCase(), value)
}

export function extractTagName(tagRef: string): string {
    const re = /^(refs\/)?tags\/(.*)$/
    const matches = re.exec(tagRef)

    if (!matches || !matches[2]) {
        throw new Error(`Reference "${tagRef}" does not appear to be a tag`)
    }

    return matches[2]
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
