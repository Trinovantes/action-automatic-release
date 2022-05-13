import path from 'path'
import type { Configuration } from 'webpack'

const isDev = (process.env.NODE_ENV === 'development')
const srcDir = path.resolve(__dirname, 'src')

const config: Configuration = {
    target: 'node',
    mode: isDev
        ? 'development'
        : 'production',

    entry: {
        index: path.resolve(srcDir, 'index.ts'),
    },

    resolve: {
        extensions: ['.ts', '.js'],
    },

    module: {
        rules: [
            {
                test: /\.tsx?$/,
                exclude: /node_modules/,
                use: 'ts-loader',
            },
        ],
    },
}

export default config
