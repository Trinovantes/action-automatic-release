export function getTagName(tagRef: string): string {
    const re = /^(refs\/)?tags\/(.*)$/
    const matches = re.exec(tagRef)

    if (!matches || !matches[2]) {
        throw new Error(`Reference "${tagRef}" does not appear to be a tag`)
    }

    return matches[2]
}
