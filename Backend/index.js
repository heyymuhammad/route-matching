const express = require("express");
const axios = require("axios");
const cors = require("cors");
const app = express();

const OSRM_API_URL = "http://router.project-osrm.org/route/v1/driving";
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(express.static("public"));

function generatePoints(route, distance) {
  const points = [];
  let accumulatedDistance = 0;
  let start = route[0];

  if (route.length > 0) {
    points.push(start);
  }

  for (let i = 1; i < route.length; i++) {
    const end = route[i];
    let segmentDistance = haversineDistance(start, end);

    while (segmentDistance >= distance) {
      const fraction = distance / segmentDistance;
      const lat = start[1] + (end[1] - start[1]) * fraction;
      const lon = start[0] + (end[0] - start[0]) * fraction;
      points.push([lon, lat]);  // Add point with longitude first

      start = [lon, lat];
      segmentDistance = haversineDistance(start, end);  // Recalculate distance
    }

    accumulatedDistance += segmentDistance;
    start = end;  // Move to the next segment start
  }

  if (route.length > 0) {
    points.push(route[route.length - 1]);
  }

  return points;
}

function haversineDistance(coord1, coord2) {
  const R = 6371000; // Earth radius in meters
  const lat1 = (coord1[1] * Math.PI) / 180;
  const lat2 = (coord2[1] * Math.PI) / 180;
  const dLat = ((coord2[1] - coord1[1]) * Math.PI) / 180;
  const dLon = ((coord2[0] - coord1[0]) * Math.PI) / 180;

  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

  return R * c;
}

async function getDrivingDistance(origin, destination) {
  const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${origin}&destination=${destination}&key=AIzaSyBKMjlIRA_lO4xejmcdaRKa5sLtSEA1tRE`;
  const response = await axios.get(url);

  if (response.data.status === 'OK') {
    return response.data.routes[0].legs[0].distance.value; // Distance in meters
  } else {
    throw new Error(`Error fetching driving distance: ${response.data.status}`);
  }
}

function calculateOverlapPercentage(driverPoints, passengerPoints) {
  const overlappingPoints = passengerPoints.filter(passengerPoint =>
    driverPoints.some(driverPoint => haversineDistance(passengerPoint, driverPoint) <= 100) // 100 meters threshold
  );

  const overlappingPointsCount = overlappingPoints.length;

  // Find the first and last overlapping points
  const firstOverlapPoint = overlappingPoints.length > 0 ? { lat: overlappingPoints[0][0], lng: overlappingPoints[0][1] } : null;
  const lastOverlapPoint = overlappingPoints.length > 0 ? { lat: overlappingPoints[overlappingPoints.length - 1][0], lng: overlappingPoints[overlappingPoints.length - 1][1] } : null;

  // Calculate the percentage based on the total number of points in the passenger route
  const overlapPercentage = (overlappingPointsCount / passengerPoints.length) * 100;

  return { overlapPercentage, firstOverlapPoint, lastOverlapPoint, overlappingPoints};
}

app.post("/match-routes", async (req, res) => {
  let { origin1, destination1, origin2, destination2 } = req.body;

  try {
    // Fetch routes for both driver and passenger
    const route1 = await getRoute(origin1, destination1); // Driver's route
    const route2 = await getRoute(origin2, destination2); // Passenger's route

    // Generate points for both routes
    const points1 = generatePoints(route1, 50); // Driver's points
    const points2 = generatePoints(route2, 50); // Passenger's points

    // Calculate overlap percentage and points
    const { overlapPercentage, firstOverlapPoint, lastOverlapPoint, overlappingPoints} = calculateOverlapPercentage(points1, points2);

    console.log("Overlapping Points: ", overlappingPoints);

    let totalOverlapDistance = await getDrivingDistance(`${overlappingPoints[0][0]},${overlappingPoints[0][1]}`, `${overlappingPoints[overlappingPoints.length - 1][0]},${overlappingPoints[overlappingPoints.length - 1][1]}`);

    console.log(`Total Overlap Distance: ${totalOverlapDistance}`);
    console.log(`Calculated overlap percentage: ${overlapPercentage}%`);

    let isSuitable = overlapPercentage >= 70; // Define your threshold
    if (isSuitable) {
      console.log("Both Parties Suitable for Carpooling towards destination~!");
    }

    response = res.json({
      isSuitable,
      overlapPercentage,
      firstOverlapPoint,
      lastOverlapPoint,
      totalOverlapDistance
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

// New endpoint to get driving distance
app.get("/get-driving-distance", async (req, res) => {
  const { origin, destination } = req.body;

  try {
    const distance = await getDrivingDistance(origin, destination);
    res.json({ distance });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: error.message });
  }
});

async function getRoute(start, end) {
  try {
    const url = `https://maps.googleapis.com/maps/api/directions/json?origin=${start.trim()}&destination=${end.trim()}&key=AIzaSyBKMjlIRA_lO4xejmcdaRKa5sLtSEA1tRE`;
    console.log('Request URL:', url);  // Log the constructed URL
    
    const response = await axios.get(url, {
      timeout: 10000,
      family: 4,
    });

    // Check if the response contains routes
    if (!response.data.routes || response.data.routes.length === 0) {
      console.error('No routes found in the response:', response.data);
      throw new Error('No routes found for the given origin and destination');
    }

    // Access the coordinates from the legs of the first route
    const coordinates = response.data.routes[0].legs[0].steps.map(step => step.polyline.points);
    console.log('Coordinates:', response.data.routes[0].legs[0].steps);
    // Flatten the array of coordinates if needed
    const flattenedCoordinates = coordinates.flatMap(point => decodePolyline(point));

    return flattenedCoordinates;
  } catch (error) {
    console.error('Error occurred in getRoute function:');
    if (error.response) {
      console.error('Error response data:', error.response.data);
      console.error('Error response status:', error.response.status);
      console.error('Error response headers:', error.response.headers);
    } else if (error.request) {
      console.error('No response received:', error.request);
    } else {
      console.error('Request error:', error.message);
    }
    throw new Error('Failed to fetch route from Google Maps API');
  }
}

// Function to decode polyline points
function decodePolyline(encoded) {
  const poly = [];
  let index = 0, len = encoded.length;
  let lat = 0, lng = 0;

  while (index < len) {
    let b, shift = 0, result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlat = ((result >> 1) ^ -(result & 1));
    lat += dlat;

    shift = 0;
    result = 0;
    do {
      b = encoded.charCodeAt(index++) - 63;
      result |= (b & 0x1f) << shift;
      shift += 5;
    } while (b >= 0x20);
    const dlng = ((result >> 1) ^ -(result & 1));
    lng += dlng;

    poly.push([lat / 1E5, lng / 1E5]);
  }
  return poly;
}

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
