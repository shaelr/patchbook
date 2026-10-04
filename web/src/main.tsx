import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ProjectList } from './pages/ProjectList.tsx'
import { ProjectView } from './pages/ProjectView.tsx'
import { PrintView } from './pages/PrintView.tsx'
import { useRoute } from './router.ts'
import { DialogHost } from './components/Dialogs.tsx'
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
