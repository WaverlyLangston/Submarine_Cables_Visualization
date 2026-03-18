/* Mapbox token*/
mapboxgl.accessToken = 'pk.eyJ1Ijoid2F2ZWxhbmdzdG9uIiwiYSI6ImNtbXBzdTRhNDByaTcyb3B3NWtkenZzYzAifQ.rLrgLnjcCmY9dEKqYAjfHw';

/* Build map, using some custom styling, or at least trying to*/
const map = new mapboxgl.Map({
    container: 'map',
    style: {
        version: 8,
        glyphs: 'mapbox://fonts/mapbox/{fontstack}/{range}.pbf',
        sources: {
            'mapbox': {
                type: 'vector',
                url: 'mapbox://mapbox.mapbox-streets-v8'
            }
        },
        layers: [
            {
                id: 'background',
                type: 'background',
                paint: {
                    'background-color': '#d4c9b5'
                }
            },
            {
                id: 'water',
                type: 'fill',
                source: 'mapbox',
                'source-layer': 'water',
                paint: {
                    'fill-color': '#a8bfb8'
                }
            },
            {
                id: 'landuse',
                type: 'fill',
                source: 'mapbox',
                'source-layer': 'landuse',
                paint: {
                    'fill-color': '#e0d8c4',
                    'fill-opacity': 0.4
                }
            },
            {
                id: 'admin-boundaries',
                type: 'line',
                source: 'mapbox',
                'source-layer': 'admin',
                filter: ['==', 'admin_level', 0],
                paint: {
                    'line-color': '#b8a892',
                    'line-width': 1,
                    'line-opacity': 0.5,
                    'line-dasharray': [2, 2]
                }
            },
            {
                id: 'place-ocean',
                type: 'symbol',
                source: 'mapbox',
                'source-layer': 'place_label',
                filter: ['==', 'type', 'sea'],
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Klokantech Noto Sans Italic'],
                    'text-size': 16,
                    'text-letter-spacing': 0.1
                },
                paint: {
                    'text-color': '#7a9590',
                    'text-halo-color': '#e8e0cc',
                    'text-halo-width': 2
                }
            },
            {
                id: 'place-continent',
                type: 'symbol',
                source: 'mapbox',
                'source-layer': 'place_label',
                filter: ['==', 'type', 'continent'],
                layout: {
                    'text-field': ['get', 'name'],
                    'text-font': ['Klokantech Noto Sans Italic'],
                    'text-size': 18,
                    'text-letter-spacing': 0.15
                },
                paint: {
                    'text-color': '#5a5048',
                    'text-halo-color': '#e8e0cc',
                    'text-halo-width': 2
                }
            }
        ]
    },
    center: [0, 20],
    zoom: 2,
    projection: 'mercator',
    renderWorldCopies: true,
    maxZoom: 10,
    minZoom: 1
});

/* Gathering data */
let cablesData = null;
let landingPointsData = null;
let allCablesInfo = [];
let minYear = 9999; /* Y2K !?!?!*/
let maxYear = 0;

/* Extracting the dates, they seem to all be "Month Year" but grabbing 4 digits just in case */
function parseYear(rfsString) {
    if (!rfsString || rfsString === 'n.a.') return null;
    const match = rfsString.match(/\d{4}/);
    if (match) {
        return parseInt(match[0]);
    }
    return null;
}

/* This helps to deal shape, makes arrays, easy to deal with empty array if there is no value*/
function parseLandingPoints(descriptionStr) {
    try {
        return JSON.parse(descriptionStr);
    } catch (e) {
        return [];
    }
}

/* Adding cable information to the tooltip */
function createCablePopup(cable) {
    const landingPoints = parseLandingPoints(cable.description || '[]');
    
    let html = `<h3>${cable.name || 'Unknown Cable'}</h3>`;
    
    /* Length, year, owners, landing points are all displayed*/
    if (cable.length) {
        html += `<div class="info-row"><span class="label">Length:</span> ${cable.length}</div>`;
    }
    if (cable.rfs) {
        html += `<div class="info-row"><span class="label">Ready for Service:</span> ${cable.rfs}</div>`;
    }
    if (cable.owners) {
        const owners = cable.owners.length > 120 ? cable.owners.substring(0, 120) + '...' : cable.owners;
        html += `<div class="info-row"><span class="label">Owners:</span> ${owners}</div>`;
    }
    if (landingPoints.length > 0) {
        html += `<div class="endpoints">`;
        html += `<div class="info-row"><span class="label">Landing Points (${landingPoints.length}):</span></div>`;
        landingPoints.forEach((point, idx) => {
            html += `<div class="endpoint">• ${point.name}</div>`;
        });
        html += `</div>`;
    }
    return html;
}

/* Setup filtering cables on year. The slider in the box will do this. */
function filterCablesByYear(targetYear) {
    if (!cablesData || !map.getLayer('cables')) return;
    
    const filter = targetYear === maxYear ? 
        ['<=', ['get', 'year'], targetYear] :
        ['all',
            ['>=', ['get', 'year'], minYear],
            ['<=', ['get', 'year'], targetYear]
        ];
    
    map.setFilter('cables', filter);
    map.setFilter('cables-hitarea', filter);
    
    /* I realized later that landing points also need to be filtered. In this case they appear with their earliest cable*/
    if (map.getLayer('landing-points')) {
        map.setFilter('landing-points', filter);
    }
}

/* --- FIX: start both the map load and the data fetches at the same time,
   then wait for whichever finishes last before adding layers. Previously
   map.on('load') was registered inside the data Promise, so if the map
   loaded first (very common) the event fired before the listener existed
   and nothing was ever drawn. --- */

const mapReady = new Promise(resolve => map.on('load', resolve));

const dataReady = Promise.all([
    fetch('cables-geo.json').then(r => {
        if (!r.ok) throw new Error('Failed to load cables-geo.json');
        return r.json();
    }),
    fetch('landing-points-geo.json').then(r => {
        if (!r.ok) throw new Error('Failed to load landing-points-geo.json');
        return r.json();
    }),
    fetch('all.json').then(r => {
        if (!r.ok) throw new Error('Failed to load all.json');
        return r.json();
    })
]);

Promise.all([mapReady, dataReady]).then(([_, [cablesGeo, landingPointsGeo, cablesInfo]]) => {
    cablesData = cablesGeo;
    landingPointsData = landingPointsGeo;
    allCablesInfo = cablesInfo;

    /* Merging the datasets to have all information */
    const cableInfoMap = {};
    const landingPointYears = {};

    cablesInfo.forEach(cable => {
        cableInfoMap[cable.id] = cable;
        const year = parseYear(cable.rfs);
        if (year !== null) {
            minYear = Math.min(minYear, year);
            maxYear = Math.max(maxYear, year);

            /* Parsing each landing point for this cable */
            const landingPoints = parseLandingPoints(cable.description || '[]');
            landingPoints.forEach(point => {
                const pointId = point.id;
                if (!landingPointYears[pointId] || landingPointYears[pointId] > year) {
                    landingPointYears[pointId] = year;
                }
            });
        }
    });

    /* Associating year with cables */
    cablesData.features.forEach(feature => {
        const info = cableInfoMap[feature.properties.id];
        if (info) {
            feature.properties = { ...feature.properties, ...info };
            const year = parseYear(info.rfs);
            feature.properties.year = year || maxYear;
        }
    });

    /* Associating year with landing points */
    landingPointsData.features.forEach(feature => {
        const pointId = feature.properties.id;
        feature.properties.year = landingPointYears[pointId] || maxYear;
    });

    /* This will change the slider labels when in use */
    document.getElementById('minYear').textContent = minYear;
    document.getElementById('maxYear').textContent = maxYear;

    /* Setup slider and make smooth, mapping range of years over width of slider */
    const slider = document.getElementById('yearSlider');
    const currentYearDisplay = document.getElementById('currentYear');

    slider.addEventListener('input', (e) => {
        const percent = parseInt(e.target.value);
        if (percent === 100) {
            filterCablesByYear(maxYear);
            currentYearDisplay.textContent = 'All cables displayed';
        } else {
            const targetYear = minYear + Math.round((maxYear - minYear) * (percent / 100));
            filterCablesByYear(targetYear);
            currentYearDisplay.textContent = `Showing cables through ${targetYear}`;
        }
    });

    /* Map is already loaded by the time we get here, so addSource/addLayer are safe to call directly */

    /* Trying to create a sense of topography, it is difficult */
    try {
        map.addSource('mapbox-dem', {
            'type': 'raster-dem',
            'url': 'mapbox://mapbox.mapbox-terrain-dem-v1',
            'tileSize': 512,
            'maxzoom': 14
        });
        map.addLayer({
            'id': 'hillshading',
            'type': 'hillshade',
            'source': 'mapbox-dem',
            'layout': {},
            'paint': {
                'hillshade-shadow-color': '#8b7355',
                'hillshade-illumination-anchor': 'viewport',
                'hillshade-exaggeration': 0.3,
                'hillshade-accent-color': '#c9b896'
            }
        });
    } catch (e) {
        console.log('Could not add hillshade:', e.message);
    }

    /* Cable lines */
    map.addSource('cables', {
        'type': 'geojson',
        'data': cablesData
    });

    /* Cables layer */
    map.addLayer({
        'id': 'cables',
        'type': 'line',
        'source': 'cables',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': [
                'concat',
                '#',
                ['get', 'color']
            ],
            'line-width': 2,
            'line-opacity': 0
        }
    });

    /* It was too hard to click on the cable so I made the area a little wider. */
    map.addLayer({
        'id': 'cables-hitarea',
        'type': 'line',
        'source': 'cables',
        'layout': {
            'line-join': 'round',
            'line-cap': 'round'
        },
        'paint': {
            'line-color': 'transparent',
            'line-width': 10,
            'line-opacity': 0.01
        }
    });

    /* Adding landing points */
    map.addSource('landing-points', {
        'type': 'geojson',
        'data': landingPointsData
    });
    map.addLayer({
        'id': 'landing-points',
        'type': 'circle',
        'source': 'landing-points',
        'paint': {
            'circle-radius': 3,
            'circle-color': '#2d5a5a',
            'circle-stroke-width': 1,
            'circle-stroke-color': '#fff',
            'circle-opacity': 0
        }
    });

    /* Made a nice little fade in effect. */
    setTimeout(() => {
        let opacity = 0;
        const fadeInterval = setInterval(() => {
            opacity += 0.05;
            if (opacity >= 0.8) {
                opacity = 0.8;
                clearInterval(fadeInterval);
            }
            try {
                map.setPaintProperty('cables', 'line-opacity', opacity);
                map.setPaintProperty('cables-hitarea', 'line-opacity', 0.01);
                map.setPaintProperty('landing-points', 'circle-opacity', opacity);
            } catch (e) {
                console.error('Animation error:', e);
                clearInterval(fadeInterval);
            }
        }, 50);
    }, 500);

    /* Mouse becomes pointer when over the clickable area */
    map.on('mouseenter', 'cables-hitarea', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'cables-hitarea', () => {
        map.getCanvas().style.cursor = '';
    });

    /* Make the tooltips appear by clicking the cable area */
    map.on('click', 'cables-hitarea', (e) => {
        const feature = e.features[0];
        const coordinates = e.lngLat;

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(createCablePopup(feature.properties))
            .addTo(map);
    });

    /* Repeat tooltip and mouse steps for landing points */
    map.on('mouseenter', 'landing-points', () => {
        map.getCanvas().style.cursor = 'pointer';
    });
    map.on('mouseleave', 'landing-points', () => {
        map.getCanvas().style.cursor = '';
    });
    map.on('click', 'landing-points', (e) => {
        const feature = e.features[0];
        const coordinates = e.lngLat;

        new mapboxgl.Popup()
            .setLngLat(coordinates)
            .setHTML(`<h3>${feature.properties.name}</h3>`)
            .addTo(map);
    });

}).catch(error => {
    console.error('❌ Error loading data:', error);
});
/*Fin*/
