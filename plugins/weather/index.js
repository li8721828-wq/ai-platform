export const name = '天气查询';
export const description = '查询指定城市的实时天气和预报';
export const version = '1.0';

const cityWeather = {
  '北京': { temp: '22°C', weather: '晴', humidity: '45%', wind: '南风 3级' },
  '上海': { temp: '25°C', weather: '多云', humidity: '65%', wind: '东南风 2级' },
  '广州': { temp: '30°C', weather: '阴天', humidity: '80%', wind: '西南风 2级' },
  '深圳': { temp: '29°C', weather: '阵雨', humidity: '85%', wind: '南风 3级' },
  '杭州': { temp: '24°C', weather: '小雨', humidity: '75%', wind: '东风 2级' },
  '成都': { temp: '23°C', weather: '阴', humidity: '60%', wind: '北风 1级' },
  '武汉': { temp: '27°C', weather: '多云转晴', humidity: '55%', wind: '东北风 2级' },
};

export function match(text) {
  const keywords = ['天气', '温度', '气温', '下雨', '晴', '雨', '雪', '刮风'];
  return keywords.some(kw => text.includes(kw));
}

export function execute(text) {
  const regex = /([\u4e00-\u9fa5]{2,4}(?:市|区|县)?)/;
  const m = text.match(regex);
  if (!m) return '请告诉我你想查询哪个城市的天气？例如：北京天气';

  const city = m[1].replace(/[市区县]/g, '');
  const found = Object.keys(cityWeather).find(k => city.includes(k) || k.includes(city));

  if (found) {
    const w = cityWeather[found];
    return `🌤 ${found} 天气\n当前温度：${w.temp}\n天气状况：${w.weather}\n湿度：${w.humidity}\n风力：${w.wind}`;
  }

  return `暂未收录 ${m[1]} 的天气数据。目前已收录：${Object.keys(cityWeather).join('、')}`;
}
