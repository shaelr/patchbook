import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ProjectList } from './pages/ProjectList.tsx'
import { ProjectView } from './pages/ProjectView.tsx'
import { PrintView } from './pages/PrintView.tsx'
import { useRoute } from './router.ts'
import { DialogHost } from './components/Dialogs.tsx'
// Bundled rather than loaded from a font service: Patchbook often runs on a show network with no internet.
import '@fontsource/barlow-semi-condensed/400.css'
import '@fontsource/barlow-semi-condensed/500.css'
import '@fontsource/barlow-semi-condensed/600.css'
import '@fontsource/barlow-condensed/600.css'
import './styles.css'

function App() {
  const route = useRoute()
  if (route.page === 'project') return <ProjectView key={route.id} id={route.id} tab={route.tab} />
  if (route.page === 'print') return <PrintView id={route.id} />
  return <ProjectList />
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
    <DialogHost />
  </StrictMode>,
)
