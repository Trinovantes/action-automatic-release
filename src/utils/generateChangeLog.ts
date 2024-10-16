import { EOL } from 'node:os'
import * as core from '@actions/core'
import { Context } from '@actions/github/lib/context'
import { Octokit } from '@octokit/rest'
import { CommitParser } from 'conventional-commits-parser'

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------

const SHORT_SHA_LEN = 8

enum ConventionalCommitTypes {
    feat = 'Features',
    fix = 'Bug Fixes',
    docs = 'Documentation',
    style = 'Styles',
    refactor = 'Code Refactoring',
    perf = 'Performance Improvements',
    test = 'Tests',
    build = 'Builds',
    ci = 'Continuous Integration',
    chore = 'Chores',
    revert = 'Reverts',
}

type ParsedCommit = {
    isBreakingChange: boolean
    authorName: string
    htmlUrl: string
    sha: string

    type?: string | null
    header?: string | null
    footer?: string | null
    body?: string | null
    scope?: string | null
    subject?: string | null

    pullRequests: Array<{
        number: number
        url: string
    }>
}

// ----------------------------------------------------------------------------
// generateChangeLog
// ----------------------------------------------------------------------------

export async function generateChangeLog(client: Octokit, context: Context, prevReleaseTag: string, headSha: string): Promise<string> {
    const parsedCommits = await getCommitsBetweenReleases(client, context, prevReleaseTag, headSha)

    let changeLog = ''

    // Breaking Changes
    changeLog += getChangeLog(parsedCommits, 'Breaking Changes', (commit) => commit.isBreakingChange)

    // Labelled Changes
    for (const [key, label] of Object.entries(ConventionalCommitTypes)) {
        changeLog += getChangeLog(parsedCommits, label, (commit) => commit.type === key)
    }

    // Unlabelled Changes
    changeLog += getChangeLog(parsedCommits, 'Commits', (commit) => {
        if (commit.type) {
            return !(commit.type in ConventionalCommitTypes)
        }

        return true
    })

    return changeLog.trim()
}

// ----------------------------------------------------------------------------
// Helpers
// ----------------------------------------------------------------------------

function getChangeLog(parsedCommits: Array<ParsedCommit>, label: string, filter: (c: ParsedCommit) => boolean): string {
    let changeLog = ''

    const filteredCommitLogs = parsedCommits
        .filter(filter)
        .map((commit) => getFormattedChangeLogEntry(commit))

    if (filteredCommitLogs.length > 0) {
        changeLog += EOL + EOL
        changeLog += EOL + EOL
        changeLog += `## ${label}` + EOL
        changeLog += filteredCommitLogs.join(EOL).trim()
    }

    return changeLog
}

function getFormattedChangeLogEntry(commit: ParsedCommit): string {
    const url = commit.htmlUrl
    const shortSha = commit.sha.substring(0, SHORT_SHA_LEN - 1)
    const author = commit.authorName

    const prMessages = commit.pullRequests.map((pr) => `[#${pr.number}](${pr.url})`)
    const prString = prMessages.join(',')

    let entry = '- '

    if (commit.type) {
        if (commit.scope) {
            entry += `**${commit.scope}**: `
        }

        entry = `${commit.subject}${prString} ([${author}](${url}))`
    } else {
        entry = `[\`${shortSha}\`](${url}): ${commit.header} (${author}) ${prString}`
    }

    return entry
}

function isBreakingChange(body: string | null, footer: string | null): boolean {
    const re = /^BREAKING\s+CHANGES?:\s+/
    return re.test(body ?? '') || re.test(footer ?? '')
}

async function getCommitsBetweenReleases(client: Octokit, context: Context, prevRelease: string, currRelease: string): Promise<Array<ParsedCommit>> {
    try {
        const prevRef = `tags/${prevRelease}`

        // Check if the tag exists
        // e.g. when we have an autoReleaseTag, the tag may not exist first time that this action runs
        await client.git.getRef({
            ...context.repo,
            ref: prevRef,
        })
    } catch (e) {
        // Not Found errors are acceptable because it's the first release
        const error = e as Error
        if (!error.message.includes('Not Found')) {
            core.error(`Failed to get reference for tag "${prevRelease}" (${error.message})`)
            throw error
        }

        core.info(`Failed to verify tag "${prevRelease}" exists. Assume that this is the first time this GitHub Action is being run.`)
        prevRelease = 'HEAD'
    }

    try {
        core.info(`Retrieving commits between ${prevRelease} and ${currRelease}`)
        const compareResult = await client.repos.compareCommits({
            ...context.repo,
            base: prevRelease,
            head: currRelease,
        })

        const parsedCommits: Array<ParsedCommit> = []
        for (const commit of compareResult.data.commits) {
            core.info(`Processing commit ${commit.sha}`)

            const commitParser = new CommitParser()
            const parsedCommit = commitParser.parse(commit.commit.message)
            if (parsedCommit.merge || parsedCommit.header?.startsWith('Merge')) {
                core.info(`Skipping merge commit ${commit.sha}`)
                continue
            }

            const pullRequests = await client.repos.listPullRequestsAssociatedWithCommit({
                owner: context.repo.owner,
                repo: context.repo.repo,
                commit_sha: commit.sha,
            })

            parsedCommits.push({
                ...parsedCommit,

                isBreakingChange: isBreakingChange(parsedCommit.body, parsedCommit.footer),
                authorName: commit.commit.author?.name ?? 'Unknown Author',
                htmlUrl: commit.html_url,
                sha: commit.sha,

                pullRequests: pullRequests.data.map((pr) => {
                    return {
                        number: pr.number,
                        url: pr.html_url,
                    }
                }),
            })
        }

        core.info(`Successfully retrieved ${parsedCommits.length} commits between ${prevRelease} and ${currRelease}`)
        return parsedCommits
    } catch (err) {
        if (err instanceof Error) {
            core.error(err)
        }

        throw new Error(`Failed to get commits between ${prevRelease} and ${currRelease}`)
    }
}
