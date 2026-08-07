import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(import.meta.env.BASE_URL),
  routes: [
    {
      path: '/',
      name: 'shelf',
      component: () => import('@/views/ShelfView.vue'),
    },
    {
      path: '/read/:id',
      name: 'read',
      component: () => import('@/views/ReaderView.vue'),
      props: true,
    },
  ],
})

export default router
