import { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { geocodeAddress } from '../utils/geocoding';

// Fix default marker icons for Leaflet with Vite bundler
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

delete (L.Icon.Default.prototype as any)._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

// Custom red pin marker (Dona Lu brand)
const donaLuIcon = L.divIcon({
  className: '',
  html: `
    <div style="
      position:relative;
      width:32px;
      height:42px;
      filter: drop-shadow(0 4px 8px rgba(0,0,0,0.5));
    ">
      <svg viewBox="0 0 32 42" fill="none" xmlns="http://www.w3.org/2000/svg" width="32" height="42">
        <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 26 16 26S32 26 32 16C32 7.163 24.837 0 16 0z" fill="#c91c1c"/>
        <path d="M16 0C7.163 0 0 7.163 0 16c0 10 16 26 16 26S32 26 32 16C32 7.163 24.837 0 16 0z" fill="url(#pinGrad)"/>
        <circle cx="16" cy="15" r="7" fill="white" opacity="0.95"/>
        <text x="16" y="19" text-anchor="middle" font-size="10" fill="#c91c1c" font-weight="bold" font-family="sans-serif">📍</text>
        <defs>
          <linearGradient id="pinGrad" x1="0" y1="0" x2="32" y2="42" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stop-color="#ef4444"/>
            <stop offset="100%" stop-color="#991b1b"/>
          </linearGradient>
        </defs>
      </svg>
    </div>
  `,
  iconSize: [32, 42],
  iconAnchor: [16, 42],
  popupAnchor: [0, -42],
});

// User location blue dot icon
const userLocationIcon = L.divIcon({
  className: '',
  html: `
    <div style="position:relative;width:20px;height:20px;">
      <div style="
        width:20px; height:20px; border-radius:50%;
        background: radial-gradient(circle, #3b82f6 0%, #1d4ed8 60%);
        border: 3px solid white;
        box-shadow: 0 0 0 3px rgba(59,130,246,0.3), 0 2px 8px rgba(0,0,0,0.4);
        box-sizing: border-box;
      "></div>
      <div style="
        position:absolute; top:50%; left:50%;
        transform: translate(-50%,-50%);
        width:40px; height:40px;
        border-radius:50%;
        background: rgba(59,130,246,0.15);
        animation: pulse-ring 2s ease-out infinite;
        pointer-events:none;
      "></div>
    </div>
  `,
  iconSize: [20, 20],
  iconAnchor: [10, 10],
});

export interface MapAddress {
  street: string;
  number: string;
  neighborhood: string;
  city: string;
  zipCode: string;
  complement?: string;
  lat?: number;
  lng?: number;
}

interface NominatimResult {
  place_id: number;
  display_name: string;
  lat: string;
  lon: string;
  name?: string;
  address: {
    road?: string;
    house_number?: string;
    suburb?: string;
    neighbourhood?: string;
    city?: string;
    town?: string;
    municipality?: string;
    postcode?: string;
    state?: string;
  };
}

interface DeliveryMapProps {
  onAddressSelect: (address: MapAddress) => void;
  initialAddress?: MapAddress;
}

export const DeliveryMap = ({ onAddressSelect, initialAddress }: DeliveryMapProps) => {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);
  const userMarkerRef = useRef<L.Marker | null>(null);

  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<NominatimResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [isRefining, setIsRefining] = useState(false);
  const [selectedAddress, setSelectedAddress] = useState<MapAddress | null>(initialAddress || null);
  const [isLocating, setIsLocating] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [showDropdown, setShowDropdown] = useState(false);
  const [complement, setComplement] = useState(initialAddress?.complement || '');

  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Initialize map
  useEffect(() => {
    if (!mapContainerRef.current || mapRef.current) return;

    const defaultCenter: L.LatLngTuple = [-22.9121, -43.5607]; // Campo Grande RJ
    const map = L.map(mapContainerRef.current, {
      center: defaultCenter,
      zoom: 15,
      zoomControl: false,
    });

    // Dark-themed map tiles (CartoDB Dark Matter)
    L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors &copy; <a href="https://carto.com/attributions">CARTO</a>',
      subdomains: 'abcd',
      maxZoom: 20,
    }).addTo(map);

    // Custom zoom control (top-right)
    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // Click on map to reverse geocode
    map.on('click', async (e: L.LeafletMouseEvent) => {
      const { lat, lng } = e.latlng;
      await reverseGeocode(lat, lng, map);
    });

    mapRef.current = map;

    // Try to get user location
    getUserLocation(map);

    return () => {
      map.remove();
      mapRef.current = null;
    };
  }, []);

  const placeMarker = useCallback((lat: number, lng: number, address: MapAddress) => {
    const map = mapRef.current;
    if (!map) return;

    if (markerRef.current) {
      markerRef.current.remove();
    }

    const marker = L.marker([lat, lng], { icon: donaLuIcon })
      .addTo(map)
      .bindPopup(
        `<div style="font-family:sans-serif;font-size:13px;line-height:1.5;min-width:180px;">
          <strong style="color:#c91c1c;">📍 Endereço de Entrega</strong><br/>
          ${address.street}${address.number ? ', ' + address.number : ''}<br/>
          ${address.neighborhood ? address.neighborhood + ' · ' : ''}${address.city}
        </div>`,
        { className: 'map-popup' }
      )
      .openPopup();

    markerRef.current = marker;
    map.flyTo([lat, lng], 17, { animate: true, duration: 1.2 });
  }, []);

  const reverseGeocode = async (lat: number, lng: number, map: L.Map) => {
    try {
      // Tenta primeiro o reverse geocoding do ArcGIS para máxima precisão de endereços e números no Brasil
      try {
        const arcgisUrl = `https://geocode.arcgis.com/arcgis/rest/services/World/GeocodeServer/reverseGeocode?f=json&location=${lng},${lat}`;
        const arcgisRes = await fetch(arcgisUrl);
        if (arcgisRes.ok) {
          const arcgisData = await arcgisRes.json();
          if (arcgisData && arcgisData.address && !arcgisData.error) {
            const a = arcgisData.address;
            
            // Extrai rua e número
            let street = a.Address || '';
            const houseNumber = a.AddNum || '';
            
            if (houseNumber && street) {
              // Remove o número e possíveis delimitadores do final da rua
              const regex = new RegExp(`[,\\s]*${houseNumber}$`, 'i');
              street = street.replace(regex, '').trim();
            }

            const addr: MapAddress = {
              street: street || a.Address || 'Rua desconhecida',
              number: houseNumber,
              neighborhood: a.District || a.Neighborhood || '',
              city: a.City || 'Rio de Janeiro',
              zipCode: a.Postal || '',
              lat,
              lng,
            };

            if (mapRef.current && mapRef.current === map) {
              setSelectedAddress(addr);
              setSearchQuery(addr.number ? `${addr.street}, ${addr.number}` : addr.street);
              setComplement('');
              placeMarker(lat, lng, addr);
              onAddressSelect(addr);
              map.flyTo([lat, lng], 17, { animate: true, duration: 1 });
              return; // Sucesso com ArcGIS, encerra a função
            }
          }
        }
      } catch (err) {
        console.warn('[reverseGeocode] Falha no reverse geocode ArcGIS. Usando Nominatim como fallback:', err);
      }

      // Fallback: Primeira chamada Nominatim (reverse geocode)
      const res = await fetch(
        `https://nominatim.openstreetmap.org/reverse?lat=${lat}&lon=${lng}&format=json&addressdetails=1&zoom=18&accept-language=pt-BR`,
        { headers: { 'Accept-Language': 'pt-BR' } }
      );
      const data = await res.json();
      if (!mapRef.current || mapRef.current !== map) return;
      if (!data?.address) return;

      let addr = buildAddress(data, lat, lng);

      // Se não veio número no Nominatim, tenta buscar o imóvel mais próximo com número via /search
      if (!addr.number && addr.street) {
        try {
          const delta = 0.001;
          const viewbox = `${lng - delta},${lat - delta},${lng + delta},${lat + delta}`;
          const searchUrl =
            `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(addr.street)}&format=json&addressdetails=1&limit=5&viewbox=${viewbox}&bounded=1&accept-language=pt-BR`;
          const res2 = await fetch(searchUrl, { headers: { 'Accept-Language': 'pt-BR' } });
          const results: NominatimResult[] = await res2.json();
          if (!mapRef.current || mapRef.current !== map) return;

          const withNumber = results.find(r => r.address?.house_number);
          if (withNumber) {
            const dLat = parseFloat(withNumber.lat) - lat;
            const dLng = parseFloat(withNumber.lon) - lng;
            const dist = Math.sqrt(dLat * dLat + dLng * dLng) * 111320;
            if (dist < 80) {
              addr = buildAddress(withNumber, lat, lng);
            }
          }
        } catch {
          // ignora erro da segunda chamada
        }
      }

      setSelectedAddress(addr);
      setSearchQuery(addr.number ? `${addr.street}, ${addr.number}` : addr.street);
      setComplement('');
      placeMarker(lat, lng, addr);
      onAddressSelect(addr);
      map.flyTo([lat, lng], 17, { animate: true, duration: 1 });
    } catch {
      // silently fail
    }
  };

  const buildAddress = (data: NominatimResult, lat: number, lng: number): MapAddress => {
    const a = data.address;
    const placeName = data.name || '';
    const roadName = a.road || '';
    
    let street = roadName;
    if (placeName && placeName !== roadName && placeName !== a.suburb && placeName !== a.neighbourhood && placeName !== a.city) {
      street = roadName ? `${placeName} - ${roadName}` : placeName;
    } else if (!roadName) {
      street = placeName || data.display_name.split(',')[0]?.trim() || 'Rua desconhecida';
    }

    return {
      street,
      number: a.house_number || '',
      neighborhood: a.suburb || a.neighbourhood || '',
      city: a.city || a.town || a.municipality || 'Rio de Janeiro',
      zipCode: a.postcode || '',
      lat,
      lng,
    };
  };

  const getUserLocation = (map: L.Map) => {
    setIsLocating(true);
    setLocationError(null);

    if (!navigator.geolocation) {
      setLocationError('Geolocalização não suportada pelo navegador.');
      setIsLocating(false);
      return;
    }

    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        if (!mapRef.current || mapRef.current !== map) return;
        const { latitude, longitude } = pos.coords;

        // Add blue "you are here" dot
        if (userMarkerRef.current) userMarkerRef.current.remove();
        const userDot = L.marker([latitude, longitude], { icon: userLocationIcon })
          .addTo(map)
          .bindTooltip('Você está aqui', { permanent: false, direction: 'top' });
        userMarkerRef.current = userDot;

        // Geocodifica a localização do usuário para carregar os detalhes do endereço
        await reverseGeocode(latitude, longitude, map);
        setIsLocating(false);
      },
      (err) => {
        if (!mapRef.current || mapRef.current !== map) return;
        console.warn('Geolocation error:', err.message);
        setLocationError('Não foi possível obter sua localização.');
        setIsLocating(false);
      },
      { timeout: 10000, maximumAge: 60000 }
    );
  };

  const handleSearchInput = (value: string) => {
    setSearchQuery(value);
    setShowDropdown(false);

    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);

    if (value.trim().length < 3) {
      setSearchResults([]);
      return;
    }

    searchDebounceRef.current = setTimeout(() => {
      performSearch(value);
    }, 500);
  };

  // Extrai número de rua de uma query de busca (ex: "Rua X, 409" ou "409 Rua X")
  const extractHouseNumber = (query: string): { number: string; street: string } | null => {
    // Padrão: "Rua Nome, 123" ou "Rua Nome 123"
    const afterComma = query.match(/^(.+?)(?:,|\s{2,})\s*(\d+[a-zA-Z]?)\s*(?:,|$)/);
    if (afterComma) return { street: afterComma[1].trim(), number: afterComma[2] };

    // Padrão: "123, Rua Nome" ou "123 Rua Nome"
    const beforeStreet = query.match(/^(\d+[a-zA-Z]?)(?:,?\s+)(.+)$/);
    if (beforeStreet) return { street: beforeStreet[2].trim(), number: beforeStreet[1] };

    return null;
  };

  const performSearch = async (query: string) => {
    setIsSearching(true);
    try {
      let results: NominatimResult[] = [];

      // Tenta primeiro via Photon API (otimizado para autocomplete/sugestão no client-side)
      try {
        const DONA_LU_LAT = -22.9112951;
        const DONA_LU_LON = -43.5602961;
        let searchQueryCleaned = query;
        if (/(condominio|condomínio|cond\.|residencial|edificio|edifício)/i.test(query)) {
          searchQueryCleaned = query
            .replace(/(condominio|condomínio|cond\.|residencial|edificio|edifício)/ig, '')
            .replace(/\s+/g, ' ')
            .trim();
        }

        const url = `https://photon.komoot.io/api/?q=${encodeURIComponent(searchQueryCleaned)}&lat=${DONA_LU_LAT}&lon=${DONA_LU_LON}&limit=10&lang=pt`;
        const res = await fetch(url);
        if (res.ok) {
          const data = await res.json();
          if (data && data.features && data.features.length > 0) {
            results = data.features
              .filter((f: any) => f.properties?.countrycode === 'BR')
              .slice(0, 5)
              .map((f: any) => {
                const prop = f.properties;
                const coordinates = f.geometry.coordinates;
                const road = prop.street || prop.name || '';
                const suburb = prop.district || prop.suburb || '';
                const city = prop.city || '';
                const state = prop.state || '';
                const country = prop.country || '';

                // Constrói display_name amigável
                const displayParts = [
                  prop.name && prop.name !== prop.street ? prop.name : null,
                  prop.street,
                  prop.housenumber ? `${prop.housenumber}` : null,
                  suburb,
                  city,
                  state,
                  country
                ].filter(Boolean);

                return {
                  place_id: prop.osm_id || Math.floor(Math.random() * 1000000),
                  display_name: displayParts.join(', '),
                  lat: coordinates[1].toString(),
                  lon: coordinates[0].toString(),
                  name: prop.name || '',
                  address: {
                    road,
                    house_number: prop.housenumber || '',
                    suburb,
                    city,
                    postcode: prop.postcode || '',
                    state
                  }
                };
              });
          }
        }
      } catch (photonErr) {
        console.warn('[performSearch] Falha ao buscar no Photon. Tentando Nominatim como fallback.', photonErr);
      }

      // Fallback: Se Photon não retornou resultados ou falhou, tenta o Nominatim original
      if (results.length === 0) {
        const parsed = extractHouseNumber(query);

        if (parsed) {
          // Busca estruturada com housenumber: mais precisa com números de rua
          const streetParam = encodeURIComponent(`${parsed.number} ${parsed.street}`);
          const structUrl = `https://nominatim.openstreetmap.org/search?format=json&limit=5&addressdetails=1&accept-language=pt-BR&street=${streetParam}&city=Rio%20de%20Janeiro&county=Rio%20de%20Janeiro&state=Rio%20de%20Janeiro&country=Brazil`;
          try {
            const res = await fetch(structUrl, { headers: { 'Accept-Language': 'pt-BR' } });
            const data: NominatimResult[] = await res.json();
            if (data.length > 0) results = data;
          } catch { /* ignore, will fallback */ }
        }

        // Fallback 1: busca livre se busca estruturada não retornou resultados
        if (results.length === 0) {
          const locationBias = query.toLowerCase().includes('campo grande') ? '' : ', Campo Grande';
          const encoded = encodeURIComponent(query + locationBias + ', Rio de Janeiro, Brasil');
          try {
            const res = await fetch(
              `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=5&addressdetails=1&accept-language=pt-BR`,
              { headers: { 'Accept-Language': 'pt-BR' } }
            );
            results = await res.json();
          } catch { /* ignore, will fallback */ }
        }

        // Fallback 2: busca sem termos como "condominio", "residencial", etc.
        if (results.length === 0 && /(condominio|condomínio|cond\.|residencial|edificio|edifício)/i.test(query)) {
          const cleanedQuery = query
            .replace(/(condominio|condomínio|cond\.|residencial|edificio|edifício)/ig, '')
            .replace(/\s+/g, ' ')
            .trim();
            
          if (cleanedQuery.length >= 3) {
            const locationBias = cleanedQuery.toLowerCase().includes('campo grande') ? '' : ', Campo Grande';
            const encoded = encodeURIComponent(cleanedQuery + locationBias + ', Rio de Janeiro, Brasil');
            try {
              const res = await fetch(
                `https://nominatim.openstreetmap.org/search?q=${encoded}&format=json&limit=5&addressdetails=1&accept-language=pt-BR`,
                { headers: { 'Accept-Language': 'pt-BR' } }
              );
              results = await res.json();
            } catch { /* ignore */ }
          }
        }
      }

      setSearchResults(results);
      setShowDropdown(results.length > 0);
    } catch {
      setSearchResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Calcula a distância em km entre dois pontos geográficos
  const getDistanceKm = (lat1: number, lng1: number, lat2: number, lng2: number) => {
    const R = 6371; // Raio da Terra em km
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = 
      Math.sin(dLat/2) * Math.sin(dLat/2) +
      Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * 
      Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
  };

  const handleSelectResult = async (result: NominatimResult) => {
    const nominatimLat = parseFloat(result.lat);
    const nominatimLng = parseFloat(result.lon);
    const addr = buildAddress(result, nominatimLat, nominatimLng);

    // Fecha dropdown imediatamente para feedback visual
    setShowDropdown(false);
    setSearchResults([]);

    // Verifica se há número de rua na query digitada pelo usuário antes de atualizar a query
    const parsed = extractHouseNumber(searchQuery);
    const houseNumber = parsed?.number || result.address.house_number || '';

    if (houseNumber) {
      addr.number = houseNumber;
      setSearchQuery(`${addr.street}, ${houseNumber}`);
    } else {
      setSearchQuery(addr.number ? `${addr.street}, ${addr.number}` : addr.street);
    }
    
    setComplement('');

    if (houseNumber) {
      // Tem número: refina com ArcGIS (geocoder de precisão de endereço)
      addr.number = houseNumber;
      setIsRefining(true);
      try {
        const [precLat, precLng] = await geocodeAddress(
          addr.street,
          houseNumber,
          addr.neighborhood,
          addr.city
        );
        
        // Verifica se a posição refinada não se desviou muito da posição original do Nominatim (limite de 1.5km)
        // Isso previne falsos positivos do geocodificador em outros bairros
        const distance = getDistanceKm(nominatimLat, nominatimLng, precLat, precLng);
        if (distance <= 1.5) {
          addr.lat = precLat;
          addr.lng = precLng;
          setSelectedAddress(addr);
          placeMarker(precLat, precLng, addr);
          onAddressSelect({ ...addr, complement: '' });
        } else {
          console.warn(`[geocoding] Desvio excessivo (${distance.toFixed(2)}km). Ignorando refinamento do ArcGIS.`);
          setSelectedAddress(addr);
          placeMarker(nominatimLat, nominatimLng, addr);
          onAddressSelect({ ...addr, complement: '' });
        }
      } catch {
        // Fallback: usa coordenadas do Nominatim
        setSelectedAddress(addr);
        placeMarker(nominatimLat, nominatimLng, addr);
        onAddressSelect({ ...addr, complement: '' });
      } finally {
        setIsRefining(false);
      }
    } else {
      // Sem número: usa coordenadas do Nominatim diretamente
      setSelectedAddress(addr);
      placeMarker(nominatimLat, nominatimLng, addr);
      onAddressSelect({ ...addr, complement: '' });
    }
  };

  const handleLocateMe = () => {
    if (mapRef.current) getUserLocation(mapRef.current);
  };

  const handleNumberChange = (val: string) => {
    if (selectedAddress) {
      const updated = { ...selectedAddress, number: val };
      setSelectedAddress(updated);
      onAddressSelect(updated);
      setSearchQuery(val ? `${updated.street}, ${val}` : updated.street);
    }
  };

  const handleComplementChange = (val: string) => {
    setComplement(val);
    if (selectedAddress) {
      onAddressSelect({ ...selectedAddress, complement: val });
    }
  };

  return (
    <div className="delivery-map-wrapper">
      {/* Search bar */}
      <div className="map-search-bar">
        <div className="map-search-input-wrapper">
          <svg className="map-search-icon" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="11" cy="11" r="8"/><path d="m21 21-4.3-4.3"/>
          </svg>
          <input
            id="map-address-search"
            type="text"
            className="map-search-input"
            placeholder="Buscar endereço de entrega..."
            value={searchQuery}
            onChange={(e) => handleSearchInput(e.target.value)}
            onFocus={() => searchResults.length > 0 && setShowDropdown(true)}
            autoComplete="off"
          />
          {(isSearching || isRefining) && <span className="map-search-spinner" />}

          {searchQuery && !isSearching && (
            <button
              type="button"
              className="map-search-clear"
              onClick={() => { setSearchQuery(''); setSearchResults([]); setShowDropdown(false); }}
              aria-label="Limpar busca"
            >✕</button>
          )}
        </div>

        {/* Locate Me button */}
        <button
          type="button"
          className="map-locate-btn"
          onClick={handleLocateMe}
          disabled={isLocating}
          title="Usar minha localização atual"
        >
          {isLocating ? (
            <span className="spinner" style={{ width: '14px', height: '14px', borderWidth: '2px' }} />
          ) : (
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
              <circle cx="12" cy="12" r="9" opacity="0.3"/>
            </svg>
          )}
          <span>{isLocating ? 'Localizando...' : 'Usar minha localização'}</span>
        </button>

        {/* Search results dropdown */}
        {showDropdown && searchResults.length > 0 && (
          <div className="map-dropdown">
            {searchResults.map((result) => {
              const parsedQuery = extractHouseNumber(searchQuery);
              const houseNumber = result.address.house_number || (parsedQuery ? parsedQuery.number : '');
              
              // Constrói o endereço usando a mesma lógica do buildAddress para manter consistência
              const addr = buildAddress(result, parseFloat(result.lat), parseFloat(result.lon));
              const firstLine = houseNumber ? `${addr.street}, ${houseNumber}` : addr.street;
              
              const secondLine = `${addr.neighborhood || ''}${addr.neighborhood && addr.city ? ', ' : ''}${addr.city}`;

              return (
                <button
                  key={result.place_id}
                  type="button"
                  className="map-dropdown-item"
                  onClick={() => handleSelectResult(result)}
                >
                  <svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" style={{ flexShrink: 0, marginTop: '2px' }}>
                    <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z"/><circle cx="12" cy="10" r="3"/>
                  </svg>
                  <div>
                    <div style={{ fontWeight: 600, fontSize: '0.85rem' }}>
                      {firstLine}
                    </div>
                    <div style={{ fontSize: '0.75rem', color: 'var(--text-secondary)', marginTop: '2px' }}>
                      {secondLine}
                    </div>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Map container */}
      <div ref={mapContainerRef} className="delivery-map-container" />

      {/* Location error */}
      {locationError && (
        <div className="map-error-banner">
          ⚠️ {locationError}
        </div>
      )}

      {/* Selected address summary */}
      {selectedAddress && (
        <div className="map-selected-address animate-fade-in">
          <div className="map-selected-address-header">
            <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="#10b981" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
              <path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
            </svg>
            <span style={{ color: '#10b981', fontWeight: 700, fontSize: '0.8rem', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Endereço Selecionado
            </span>
          </div>
          <div className="map-selected-address-info">
            <p>
              <strong>{selectedAddress.street}{selectedAddress.number ? `, ${selectedAddress.number}` : ''}</strong>
            </p>
            <p style={{ color: 'var(--text-secondary)', fontSize: '0.85rem' }}>
              {selectedAddress.neighborhood && `${selectedAddress.neighborhood} · `}{selectedAddress.city}
              {selectedAddress.zipCode && ` · CEP ${selectedAddress.zipCode}`}
            </p>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 2fr', gap: '0.75rem', marginTop: '0.75rem' }}>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                Número *
              </label>
              <input
                type="text"
                className="pastel-edit-input"
                style={{ marginBottom: 0 }}
                placeholder="Ex: 409"
                value={selectedAddress.number}
                onChange={(e) => handleNumberChange(e.target.value)}
              />
            </div>
            <div>
              <label style={{ fontSize: '0.8rem', color: 'var(--text-secondary)', display: 'block', marginBottom: '0.35rem' }}>
                Complemento
              </label>
              <input
                type="text"
                className="pastel-edit-input"
                style={{ marginBottom: 0 }}
                placeholder="Ex: Apto 201, Bloco B"
                value={complement}
                onChange={(e) => handleComplementChange(e.target.value)}
              />
            </div>
          </div>
          <div style={{ marginTop: '0.5rem', fontSize: '0.75rem', color: 'var(--text-secondary)', fontStyle: 'italic' }}>
            💡 Clique em qualquer ponto do mapa para ajustar o marcador.
          </div>
        </div>
      )}

      {!selectedAddress && (
        <div className="map-hint-banner">
          🗺️ Clique no mapa ou busque o endereço acima para definir o local de entrega.
        </div>
      )}
    </div>
  );
};

export default DeliveryMap;
