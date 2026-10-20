import { useEffect, useState } from 'react'

// A start page that proves the site and the data load, on localhost and on GitHub Pages.
// Replace it with your app.
export default function App() {
  const [kit, setKit] = useState(null)
  const [error, setError] = useState(null)

  useEffect(() => {
    fetch(`${import.meta.env.BASE_URL}data/kit.json`)
      .then((r) => {
        if (!r.ok) throw new Error(`data/kit.json: ${r.status}`)
        return r.json()
      })
      .then(setKit)
      .catch((e) => setError(e.message))
  }, [])

  return (
    <main>
      <h1>Nothing here yet</h1>
      {error && <p className="error">The city kit didn't load ({error}).</p>}
      {kit && (
        <p>
          The city kit is ready: {kit.label}, {kit.size_m[0]} × {kit.size_m[1]} m, generated on {kit.generated}.
          The data is in <code>public/data/</code>. Ask your agent to build something with it.
        </p>
      )}
    </main>
  )
}
