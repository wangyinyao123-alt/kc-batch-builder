/**
 * Web Awesome（MIT）按需注册 —— 只引入右侧面板真正用到的组件。
 *
 * 不用 dist/webawesome.js 的自动加载器：它是运行时按需 import，
 * 我们的构建是静态打包，自动加载器反而会把全部组件都塞进产物。
 *
 * 每个组件一个 import，构建时能按需摇树；下面这一组的代价约 90KB（gzip 后更小），
 * 换掉的是原生控件在 macOS / Windows 上三套完全不同的丑陋外观。
 */
import '@awesome.me/webawesome/dist/components/button/button.js';
import '@awesome.me/webawesome/dist/components/select/select.js';
import '@awesome.me/webawesome/dist/components/option/option.js';
import '@awesome.me/webawesome/dist/components/number-input/number-input.js';
import '@awesome.me/webawesome/dist/components/textarea/textarea.js';
import '@awesome.me/webawesome/dist/components/radio-group/radio-group.js';
import '@awesome.me/webawesome/dist/components/radio/radio.js';
import '@awesome.me/webawesome/dist/components/tooltip/tooltip.js';
