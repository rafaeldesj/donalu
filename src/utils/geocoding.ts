// Coordenadas da Dona Lu como âncora geográfica
export const DONA_LU_COORDS: [number, number] = [-22.9112951, -43.5602961];

/**
 * Utilitário de geocodificação robusto com múltiplos fallbacks.
 * Projetado para funcionar perfeitamente no ambiente do cliente (browser).
 */
export async function geocodeAddress(
  street: string,
  number: string,
  neighborhood: string,
  city = 'Rio de Janeiro'
): Promise<[number, number]> {
  const cleanStreet = street.trim();
  const cleanNumber = number.trim();
  const cleanNeighborhood = neighborhood.trim() || 'Campo Grande';

  // Nível 0: ArcGIS public geocoder (extremamente preciso para números de rua no Brasil, estilo Google Maps)
  if (cleanNumber) {
    try {
      const query = `${cleanStreet}, ${cleanNumber}, ${cleanNeighborhood}, ${city}, Brazil`;
      const url = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/findAddressCandidates?f=json&singleLine=${encodeURIComponent(query)}&maxLocations=1`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.candidates && data.candidates.length > 0) {
          const candidate = data.candidates[0];
          if (candidate.score >= 90 && candidate.location) {
            const lat = candidate.location.y;
            const lon = candidate.location.x;
            if (!isNaN(lat) && !isNaN(lon)) {
              console.log(`[geocoding] Sucesso Nível 0 (ArcGIS): [${lat}, ${lon}] com score ${candidate.score}`);
              return [lat, lon];
            }
          }
        }
      }
    } catch (err) {
      console.warn('[geocoding] Falha no geocodificador Nível 0 (ArcGIS):', err);
    }
  }

  // Nível 1: Endereço completo (Rua, Número, Bairro, Cidade, Brasil) via Nominatim
  if (cleanNumber) {
    try {
      const query = `${cleanStreet}, ${cleanNumber}, ${cleanNeighborhood}, ${city}, Brazil`;
      const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`;
      const res = await fetch(url);
      if (res.ok) {
        const data = await res.json();
        if (data && data.length > 0) {
          const lat = parseFloat(data[0].lat);
          const lon = parseFloat(data[0].lon);
          if (!isNaN(lat) && !isNaN(lon)) {
            console.log(`[geocoding] Sucesso Nível 1 (Completo): [${lat}, ${lon}]`);
            return [lat, lon];
          }
        }
      }
    } catch (err) {
      console.warn('[geocoding] Falha no geocodificador Nível 1:', err);
    }
  }

  // Nível 2: Sem número (Segmento da Rua no Bairro)
  try {
    const query = `${cleanStreet}, ${cleanNeighborhood}, ${city}, Brazil`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          console.log(`[geocoding] Sucesso Nível 2 (Rua + Bairro): [${lat}, ${lon}]`);
          return [lat, lon];
        }
      }
    }
  } catch (err) {
    console.warn('[geocoding] Falha no geocodificador Nível 2:', err);
  }

  // Nível 3: Apenas Rua e Cidade
  try {
    const query = `${cleanStreet}, ${city}, Brazil`;
    const url = `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=1&countrycodes=br`;
    const res = await fetch(url);
    if (res.ok) {
      const data = await res.json();
      if (data && data.length > 0) {
        const lat = parseFloat(data[0].lat);
        const lon = parseFloat(data[0].lon);
        if (!isNaN(lat) && !isNaN(lon)) {
          console.log(`[geocoding] Sucesso Nível 3 (Apenas Rua): [${lat}, ${lon}]`);
          return [lat, lon];
        }
      }
    }
  } catch (err) {
    console.warn('[geocoding] Falha no geocodificador Nível 3:', err);
  }

  // Fallback Final Seguro: Coordenadas da Pastelaria Dona Lu
  console.warn(`[geocoding] Geocodificação falhou completamente para "${cleanStreet}". Usando coordenadas da Dona Lu como fallback.`);
  return DONA_LU_COORDS;
}
