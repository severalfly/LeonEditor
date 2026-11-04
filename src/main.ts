import { createApp } from 'vue'
import App from './App.vue'
// 必须先于任何组件执行：注册 Monaco worker、自定义主题、额外语言
import './lib/monaco-setup'
import './styles/main.css'

createApp(App).mount('#app')
