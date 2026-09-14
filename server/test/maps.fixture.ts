import type { Point } from '../src/domain';

export const pickup = {latitude:42.8756, longitude:74.604, address:'Площадь Ала-Тоо'};
export const dropoff = {latitude:42.8528, longitude:74.584, address:'Парк Ататюрк'};

// Deterministic provider payload used only in tests; runtime never invents a road route.
export function osrmFixture(start: Point = pickup, finish: Point = dropoff) {
  const a = [start.longitude, start.latitude], b = [finish.longitude, finish.latitude];
  const middle = [(a[0]+b[0])/2, (a[1]+b[1])/2];
  return {code:'Ok', routes:[{
    distance:3210.4, duration:550.2, geometry:{type:'LineString', coordinates:[a, middle, b]},
    legs:[{steps:[
      {distance:1600.1, duration:275.1, name:'улица Киевская', geometry:{type:'LineString', coordinates:[a,middle]}, maneuver:{type:'depart',location:a,bearing_before:0,bearing_after:90}},
      {distance:1610.3, duration:275.1, name:'проспект Манаса', geometry:{type:'LineString', coordinates:[middle,b]}, maneuver:{type:'turn',modifier:'right',location:middle,bearing_before:90,bearing_after:180}},
      {distance:0, duration:0, name:'проспект Манаса', geometry:{type:'LineString', coordinates:[b,b]}, maneuver:{type:'arrive',modifier:'right',location:b,bearing_before:180,bearing_after:0}},
    ]}],
  }]};
}
