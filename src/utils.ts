import * as core from '@actions/core'

export function getGitTag(tagRef: string): string {
    const re = /^(refs\/)?tags\/(.*)$/
    const matches = re.exec(tagRef)

    if (!matches || !matches[2]) {
        core.info(`Input "${tagRef}" does not appear to be a tag`)
        return ''
    }

    return matches[2]
}
