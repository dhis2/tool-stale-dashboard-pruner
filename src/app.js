"use strict";

//CSS
import "./css/header.css";
import "./css/style.css";
import $ from "jquery";
import DataTable from "datatables.net";
import "datatables.net-dt/css/dataTables.dataTables.css";
window.DataTable = DataTable;

function getContextPath() {
    var ctx = window.location.pathname.substring(0, window.location.pathname.indexOf("/", 2));
    console.log("Context path: " + ctx);
    if (ctx == "/api") return "";
    return ctx;
}

const baseUrl = getContextPath() + "/api/";
const check_code = "dashboards_not_viewed_one_year";


function performPostAndGet(baseUrl, path) {
    return new Promise((resolve, reject) => {
        fetch(baseUrl + path, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
            },
        })
            .then(response => response.json())
            .then(() => {
                let tries = 0;

                function checkForResponse() {
                    fetch(baseUrl + path, {
                        method: "GET",
                        headers: {
                            "Content-Type": "application/json",
                        },
                    })
                        .then(response => response.json())
                        .then(getData => {
                            if (Object.keys(getData).length > 0 || tries >= 10) {
                                resolve(getData);
                            } else {
                                tries++;
                                setTimeout(checkForResponse, 1000);
                            }
                        })
                        .catch(error => {
                            console.error("Error checking for response:", error);
                            reject(error);
                        });
                }

                checkForResponse();
            })
            .catch(error => {
                console.error("Error making POST request:", error);
                reject(error);
            });
    });
}

function renderDetailsTable(detailsObject) {
    var html = "<div id='details_table'><h2>Stale dashboards</h2>";
    html += "<h3>Dashboards which have not been viewed in at least 12 months</h3>";
    html = html + "<table id='details' class='display' width='100%'>";
    html = html + "<thead><tr><th>Dashboard name</th><th>ID</th><th>Last access (days)</th><th>Delete</th><th>Select</th></thead><tbody>";
    detailsObject.issues.forEach((issue) => {
        if (issue.comment) {
            var date = new Date(issue.comment);
            var now = new Date();
            var diff = now - date;
            var days = Math.floor(diff / (1000 * 60 * 60 * 24));
            issue.comment = days;
        }
    });

    detailsObject.issues.forEach((issue) => {
        html += "<tr>";
        html += "<td>" + issue.name + "</td>";
        html += "<td><a href='" + getContextPath() + "/dhis-web-dashboard/#/" + issue.id + "' target='_blank'>" + issue.id + "</a></td>";
        html += "<td>" + (issue.comment ? issue.comment : "-") + "</td>";
        html += "<td><button onclick='deleteSelectedDashboard(\"" + issue.id + "\")'>Delete</button></td>";
        html += "<td><input type='checkbox' class='dashboard-select' value='" + issue.id + "'></td>";
        html += "</tr>";
    });

    html = html + "</tbody></table></div>";

    // Initialize DataTable with custom range search
    setTimeout(() => {
        new DataTable("#details", { "paging": true, "searching": true, order: [[2, "desc"]] });

        // Custom range search
        $.fn.dataTable.ext.search.push(
            function (settings, data) {
                var min = parseInt($("#min").val(), 10);
                var max = parseInt($("#max").val(), 10);
                var age = parseFloat(data[2]) || 0; // use data for the age column

                if (
                    (isNaN(min) && isNaN(max)) ||
                    (isNaN(min) && age <= max) ||
                    (min <= age && isNaN(max)) ||
                    (min <= age && age <= max)
                ) {
                    return true;
                }
                return false;
            }
        );

        // Event listener to the two range filtering inputs to redraw on input
        $("#min, #max").on("keyup", function () {
            $("#details").DataTable().draw();
        });
    }, 0);

    return html;
}

async function runDetails(code) {
    var path = "dataIntegrity/details?checks=" + code;
    performPostAndGet(baseUrl, path)
        .then(data => {
            const name = Object.keys(data)[0];
            var this_check = data[name];
            var this_html = renderDetailsTable(this_check);
            $("#detailsReport").html(this_html);
        })
        .catch(error => {
            console.error("Error in runDetails:", error);
        });
}


async function deleteSelectedDashboard(uid) {
    if (confirm("Are you sure you want to delete this dashboard?")) {
        try {
            const response = await fetch(baseUrl + "dashboards/" + uid, {
                method: "DELETE",
                headers: {
                    "Content-Type": "application/json",
                },
            });
            const json = await response.json();

            if (response.status == 200) {
                alert("Dashboard deleted");
            } else {
                alert("Error deleting dashboard: " + json.message + " (" + response.status + ")");
                
            }
            //Need to refresh the table
            await runDetails(check_code);

        } catch (error) {
            console.error("Error deleting dashboard:", error);
        }
    }
}

async function deleteSelectedDashboards() {
    const selectedCount = $(".dashboard-select:checked").length;
    if (confirm("You are about to delete " + selectedCount + " dashboards. This operation cannot be undone. Are you sure?")) {
        const selectedDashboards = $(".dashboard-select:checked").map((index, checkbox) => checkbox.value).get();
        const maxConcurrentRequests = 10;

        try {
            let successCount = 0;
            let failureCount = 0;
            $("#statusReport").html(`Deleting ${selectedDashboards.length} dashboards...`);
            for (let i = 0; i < selectedDashboards.length; i += maxConcurrentRequests) {
                const batch = selectedDashboards.slice(i, i + maxConcurrentRequests);
                const results = await Promise.all(batch.map(async uid => {
                    const response = await fetch(baseUrl + "dashboards/" + uid, {
                        method: "DELETE",
                        headers: {
                            "Content-Type": "application/json",
                        },
                    });
                    return response.status;
                }));

                successCount += results.filter(status => status === 200).length;
                failureCount += results.filter(status => status !== 200).length;
                //Need to update the status report with the number of remaining dashboards to delete
                $("#statusReport").html(`Working to delete ${selectedDashboards.length - successCount - failureCount} dashboards...`);
            }
            //Need to refresh the table
            $("#statusReport").html("");
            await runDetails(check_code);
            alert(`Deletion summary: ${successCount} succeeded, ${failureCount} failed`);
        } catch (error) {
            console.error("Error deleting dashboards:", error);
        }
    }
}

async function checkVersion() {
    try {
        const response = await fetch(baseUrl + "system/info");
        const data = await response.json();
        const version = data.version.split(".")[1];
        console.log("DHIS2 version:", version);
        return version >= 39;
    } catch (error) {
        console.error("Error checking DHIS2 version:", error);
        return false;
    }
}

window.deleteSelectedDashboard = deleteSelectedDashboard;
window.deleteSelectedDashboards = deleteSelectedDashboards;
window.baseUrl = baseUrl;

(async () => {
    const is_supported = await checkVersion();
    if (is_supported) {
        runDetails(check_code);
    } else {
        $("#detailsReport").html("<h2>Unsupported DHIS2 version</h2>");
    }
})();
