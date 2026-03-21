import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.DEV ? 'http://localhost:3000' : '',
})

api.interceptors.request.use((config) => {
  const token = localStorage.getItem('rv_token')
  if (token) {
    config.headers.Authorization = `Bearer ${token}`
  }
  return config
})

export default api
