import path from 'node:path'
import { Configuration, optimize } from 'webpack'

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

    optimization: {
        minimize: false,
    },

    plugins: [
        new optimize.LimitChunkCountPlugin({
            maxChunks: 1,
        }),
    ],

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
