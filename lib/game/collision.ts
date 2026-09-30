type Point = {
    x: number;
    y: number;
    z: number;
};
/** First sphere contact on a swept segment, as a fraction in [0, 1]. */
export function segmentSphere(start: Point, end: Point, center: Point, radius: number): number | null {
    const dx = end.x - start.x, dy = end.y - start.y, dz = end.z - start.z;
    const ox = start.x - center.x, oy = start.y - center.y, oz = start.z - center.z;
    const c = ox * ox + oy * oy + oz * oz - radius * radius;
    if (c <= 0)
        return 0;
    const a = dx * dx + dy * dy + dz * dz;
    if (!a)
        return null;
    const b = ox * dx + oy * dy + oz * dz;
    const discriminant = b * b - a * c;
    if (discriminant < 0)
        return null;
    const t = (-b - Math.sqrt(discriminant)) / a;
    return t >= 0 && t <= 1 ? t : null;
}
