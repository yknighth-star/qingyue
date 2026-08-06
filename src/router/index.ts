import { createRouter, createWebHistory } from 'vue-router'

const router = createRouter({
  history: createWebHistory(),
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
