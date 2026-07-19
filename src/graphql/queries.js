import { gql } from "@apollo/client/index.js";

export const GET_REVENUE_DATA = gql`
  query RevenueData {
    revenue_datas(first: 100000) {
      items {
        Year
        Month
        MonthNo
        LOB
        Sub_LOB
        Trans_Recurring
        Region
        Is_JV
        USD_Amount
        USD_Budget_BR
        USD_Q2_Forecast_FR
      }
    }
  }
`;

export const GET_ISSUANCE_DATA = gql`
  query IssuanceData {
    issuance_datas(first: 100000) {
      items {
        Year
        Month
        MonthNo
        LOB
        Sub_LOB
        High_Level_Product
        Pricing_Construct
        New_Existing
        External_Reporting_Ind
        Region
        Volumes__M
        Deals
        Budget_Volumes__M
        Budget_Deals
        Q2_Forecast_Volumes__M
        Q2_Forecast_Deals
      }
    }
  }
`;