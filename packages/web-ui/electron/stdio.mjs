/** Launchers may exit while the desktop stays open. Logging must not close the app with them. */
export function protectStandardStreams(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    stream.on('error', error => {
      if (error.code !== 'EPIPE') throw error
    })
  }
}
