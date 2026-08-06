import { createApp } from 'vue'
import { createPinia } from 'pinia'
import { registerSW } from 'virtual:pwa-register'
import App from './App.vue'
import router from './router'
import './styles/main.css'

// Force SW update so stale GitHub Pages caches (old hashed pdf.worker) are dropped
registerSW({
  immediate: true,
  onRegisteredSW(_url, registration) {
    void registration?.update()
  },
})

const app = createApp(App)
app.use(createPinia())
app.use(router)
app.mount('#app')
