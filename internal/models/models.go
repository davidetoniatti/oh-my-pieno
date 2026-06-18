package models

type Location struct {
	Lat float64 `json:"lat"`
	Lng float64 `json:"lng"`
}

type Fuel struct {
	ID            int     `json:"id"`
	Price         float64 `json:"price"`
	Name          string  `json:"name"`
	FuelID        int     `json:"fuelId"`
	IsSelf        bool    `json:"isSelf"`
	ServiceAreaID int     `json:"serviceAreaId,omitempty"`
	InsertDate    string  `json:"insertDate,omitempty"`
	ValidityDate  string  `json:"validityDate,omitempty"`
}

type GasStation struct {
	ID               int       `json:"id"`
	Name             string    `json:"name"`
	Fuels            []Fuel    `json:"fuels"`
	Location         *Location `json:"location,omitempty"`
	InsertDate       string    `json:"insertDate,omitempty"`
	Address          *string   `json:"address"`
	Brand            string    `json:"brand"`
	Distance         string    `json:"distance,omitempty"`
	PhoneNumber      string    `json:"phoneNumber,omitempty"`
	Email            string    `json:"email,omitempty"`
	Website          string    `json:"website,omitempty"`
	Company          string    `json:"company,omitempty"`
	SelectedPrice    float64   `json:"selectedPrice,omitempty"`
	SelectedFuelName string    `json:"selectedFuelName,omitempty"`
}

type SearchRequest struct {
	Points []Location `json:"points"`
	Radius int        `json:"radius"`
}

type SearchResponse struct {
	Success bool         `json:"success"`
	Center  Location     `json:"center"`
	Results []GasStation `json:"results"`
}

type FuelType struct {
	ID   int    `json:"id"`
	Name string `json:"name"`
}
