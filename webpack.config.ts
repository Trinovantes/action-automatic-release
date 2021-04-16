import path from 'path'
import TerserPlugin from 'terser-webpack-plugin'
import webpack from 'webpack'

const isDev = (process.env.NODE_ENV === 'development')
const srcDir = path.resolve(__dirname, 'src')

const config: webpack.Configuration = {
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
                use: [
                    'ts-loader',
                ],
            },
        ],
    },

    optimization: {
        minimizer: [
            new TerserPlugin({
                terserOptions: {
                    compress: {
                        drop_console: !isDev,
                    },
                },
            }),
        ],
    },
}

export default config
